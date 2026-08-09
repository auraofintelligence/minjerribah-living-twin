// Sun and moon geometry for 27.43°S, 153.45°E. Drives lighting, colour, and any behaviour
// that keys off first light, last light, or the moon (turtles, mullet, night fishing, the drama director).

const LAT = -27.4283 * Math.PI / 180;
const LON = 153.4517;
const TZ_OFFSET = 10; // AEST, no daylight saving in Queensland

export function registerDaylight(world) {
  const state = world.publish('daylight', {
    altitude: 0, azimuth: 0, elevationDeg: 0,
    sunriseMin: 0, sunsetMin: 0, solarNoonMin: 0,
    isDay: false, isCivilTwilight: false, isGolden: false, isBlue: false,
    dayLengthMin: 0, moonPhase: 0, moonIllum: 0, moonAltitudeDeg: 0
  });

  function solar(dayOfYear, minuteOfDay) {
    const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (minuteOfDay / 60 - 12) / 24);
    const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
      - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
    const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
      - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
      - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
    const timeOffset = eqTime + 4 * LON - 60 * TZ_OFFSET;
    const tst = minuteOfDay + timeOffset;
    const ha = ((tst / 4) - 180) * Math.PI / 180;
    const cosZen = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(ha);
    const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
    const alt = Math.PI / 2 - zen;
    let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(LAT) - Math.tan(decl) * Math.cos(LAT));
    az = az + Math.PI; // from north, clockwise
    return { alt, az, decl, eqTime, timeOffset };
  }

  function sunEventMinutes(dayOfYear, zenithDeg) {
    const { decl, eqTime } = solar(dayOfYear, 720);
    const zen = zenithDeg * Math.PI / 180;
    const cosH = (Math.cos(zen) - Math.sin(LAT) * Math.sin(decl)) / (Math.cos(LAT) * Math.cos(decl));
    if (cosH > 1) return null;   // never rises
    if (cosH < -1) return 'all'; // never sets
    const ha = Math.acos(cosH) * 180 / Math.PI;
    const noon = 720 - 4 * (LON - 15 * TZ_OFFSET) - eqTime;
    return { rise: noon - ha * 4, set: noon + ha * 4, noon };
  }

  return world.register({
    id: 'daylight',
    phase: 'environment',
    order: 5,

    init(w) { update(w); },
    tick(w) { update(w); },

    describe() {
      return {
        elevationDeg: +state.elevationDeg.toFixed(1),
        isDay: state.isDay,
        sunrise: fmt(state.sunriseMin),
        sunset: fmt(state.sunsetMin),
        moonIllum: +state.moonIllum.toFixed(2)
      };
    }
  });

  function update(w) {
    const doy = w.clock.dayOfYear;
    const s = solar(doy, w.clock.minuteOfDay);
    state.altitude = s.alt;
    state.azimuth = s.az;
    state.elevationDeg = s.alt * 180 / Math.PI;

    const ev = sunEventMinutes(doy, 90.833);
    if (ev && ev !== 'all') {
      state.sunriseMin = ev.rise; state.sunsetMin = ev.set; state.solarNoonMin = ev.noon;
      state.dayLengthMin = ev.set - ev.rise;
    }
    const e = state.elevationDeg;
    state.isDay = e > -0.833;
    state.isCivilTwilight = e <= -0.833 && e > -6;
    state.isGolden = e > -0.833 && e < 6;
    state.isBlue = e <= -0.5 && e > -6;

    // Moon: synodic approximation, good enough for light level and for the fishing calendar.
    const daysSinceNewMoon = ((w.clock.epochDay + w.clock.dayIndex) - 5.5 + w.clock.dayFraction) % 29.530588853;
    state.moonPhase = daysSinceNewMoon / 29.530588853;
    state.moonIllum = (1 - Math.cos(2 * Math.PI * state.moonPhase)) / 2;
    // Moon transits roughly 50 min later each day; crude altitude for night ambience.
    const moonHourAngle = ((w.clock.minuteOfDay / 60) - (12 + state.moonPhase * 24)) * 15 * Math.PI / 180;
    state.moonAltitudeDeg = Math.asin(Math.sin(LAT) * Math.sin(0.4) + Math.cos(LAT) * Math.cos(0.4) * Math.cos(moonHourAngle)) * 180 / Math.PI;
  }

  function fmt(min) {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
