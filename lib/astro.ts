/**
 * A small astronomy engine for "tonight's sky": where the Moon and the five bright planets are for a place and a
 * moment, how lit they are, how bright, when they rise and set, and when the next new and full moons are.
 *
 * Positions use the low-precision orbital elements of P. Schlyter ("How to compute planetary positions"), with his
 * perturbation terms for the Moon, Jupiter and Saturn: good to a few arcminutes for these purposes. No network, no
 * data files; pure functions of (time, latitude, longitude). Angles inside are degrees.
 */
export type BodyId = "moon" | "mercury" | "venus" | "mars" | "jupiter" | "saturn";
export type Body = {
  id: BodyId;
  name: string;
  /** Degrees above the horizon (negative: below), and the compass bearing from north through east. */
  alt: number;
  az: number;
  /** Lit fraction of the disc, 0 to 1; and whether it is growing (waxing / evening side) rather than shrinking. */
  illum: number;
  waxing: boolean;
  /** Apparent magnitude (smaller is brighter); angle from the Sun in degrees. */
  mag: number;
  elongation: number;
  /** Saturn only: how far its rings are tilted towards us, in degrees (signed). */
  ringTilt?: number;
  rises?: Date;
  sets?: Date;
  /** The compass bearing where it comes up and goes down (not where it is now). */
  riseAz?: number;
  setAz?: number;
};
export type Sky = {
  /** The moment the sky is for (now if it is dark, otherwise 9 pm this evening). */
  when: Date;
  sunAlt: number;
  dark: boolean;
  bodies: Body[];
  moonAge: number;
  nextFull: Date;
  nextNew: Date;
};

/** Chennai: where the app lives unless told otherwise. */
export const HOME_LATLON = { lat: 13.0827, lon: 80.2707 };

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const sin = (x: number) => Math.sin(x * RAD);
const cos = (x: number) => Math.cos(x * RAD);
const norm = (x: number) => ((x % 360) + 360) % 360;
const norm180 = (x: number) => norm(x + 180) - 180;

export const julianDay = (d: Date) => d.getTime() / 86400000 + 2440587.5;

type Elements = { N: number; i: number; w: number; a: number; e: number; M: number };
const elements = (id: BodyId | "sun", d: number): Elements => {
  switch (id) {
    case "sun":
      return { N: 0, i: 0, w: 282.9404 + 4.70935e-5 * d, a: 1, e: 0.016709 - 1.151e-9 * d, M: 356.047 + 0.9856002585 * d };
    case "moon":
      return { N: 125.1228 - 0.0529538083 * d, i: 5.1454, w: 318.0634 + 0.1643573223 * d, a: 60.2666, e: 0.0549, M: 115.3654 + 13.0649929509 * d };
    case "mercury":
      return { N: 48.3313 + 3.24587e-5 * d, i: 7.0047 + 5e-8 * d, w: 29.1241 + 1.01444e-5 * d, a: 0.387098, e: 0.205635 + 5.59e-10 * d, M: 168.6562 + 4.0923344368 * d };
    case "venus":
      return { N: 76.6799 + 2.4659e-5 * d, i: 3.3946 + 2.75e-8 * d, w: 54.891 + 1.38374e-5 * d, a: 0.72333, e: 0.006773 - 1.302e-9 * d, M: 48.0052 + 1.6021302244 * d };
    case "mars":
      return { N: 49.5574 + 2.11081e-5 * d, i: 1.8497 - 1.78e-8 * d, w: 286.5016 + 2.92961e-5 * d, a: 1.523688, e: 0.093405 + 2.516e-9 * d, M: 18.6021 + 0.5240207766 * d };
    case "jupiter":
      return { N: 100.4542 + 2.76854e-5 * d, i: 1.303 - 1.557e-7 * d, w: 273.8777 + 1.64505e-5 * d, a: 5.20256, e: 0.048498 + 4.469e-9 * d, M: 19.895 + 0.0830853001 * d };
    case "saturn":
      return { N: 113.6634 + 2.3898e-5 * d, i: 2.4886 - 1.081e-7 * d, w: 339.3939 + 2.97661e-5 * d, a: 9.55475, e: 0.055546 - 9.499e-9 * d, M: 316.967 + 0.0334442282 * d };
  }
};

/** Position in the orbit: distance r and true anomaly v. */
function orbit(el: Elements) {
  const M = norm(el.M);
  let E = M + el.e * DEG * sin(M) * (1 + el.e * cos(M));
  for (let k = 0; k < 8; k++) {
    const dE = (E - el.e * DEG * sin(E) - M) / (1 - el.e * cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-7) break;
  }
  const xv = el.a * (cos(E) - el.e);
  const yv = el.a * Math.sqrt(1 - el.e * el.e) * sin(E);
  return { r: Math.hypot(xv, yv), v: Math.atan2(yv, xv) * DEG };
}

/** Ecliptic rectangular coordinates (heliocentric for a planet, geocentric for the Moon). */
function rect(el: Elements, r: number, v: number) {
  const vw = v + el.w;
  return {
    x: r * (cos(el.N) * cos(vw) - sin(el.N) * sin(vw) * cos(el.i)),
    y: r * (sin(el.N) * cos(vw) + cos(el.N) * sin(vw) * cos(el.i)),
    z: r * sin(vw) * sin(el.i),
  };
}

const polar = (p: { x: number; y: number; z: number }) => ({ lon: norm(Math.atan2(p.y, p.x) * DEG), lat: Math.atan2(p.z, Math.hypot(p.x, p.y)) * DEG, r: Math.hypot(p.x, p.y, p.z) });
const cart = (lon: number, lat: number, r: number) => ({ x: r * cos(lon) * cos(lat), y: r * sin(lon) * cos(lat), z: r * sin(lat) });

function sunPos(d: number) {
  const el = elements("sun", d);
  const { r, v } = orbit(el);
  const lon = norm(v + el.w);
  return { lon, r, x: r * cos(lon), y: r * sin(lon) };
}

/** Geocentric ecliptic longitude / latitude and distances for a body at day number d. */
function geo(id: BodyId, d: number) {
  const sun = sunPos(d);
  const Ms = norm(elements("sun", d).M);
  if (id === "moon") {
    const el = elements("moon", d);
    const { r, v } = orbit(el);
    const p = polar(rect(el, r, v));
    const Mm = norm(el.M);
    const Lm = norm(el.N + el.w + el.M);
    const Ls = norm(Ms + elements("sun", d).w);
    const D = Lm - Ls;
    const F = Lm - el.N;
    const lon = p.lon + -1.274 * sin(Mm - 2 * D) + 0.658 * sin(2 * D) - 0.186 * sin(Ms) - 0.059 * sin(2 * Mm - 2 * D) - 0.057 * sin(Mm - 2 * D + Ms) + 0.053 * sin(Mm + 2 * D) + 0.046 * sin(2 * D - Ms) + 0.041 * sin(Mm - Ms) - 0.035 * sin(D) - 0.031 * sin(Mm + Ms) - 0.015 * sin(2 * F - 2 * D) + 0.011 * sin(Mm - 4 * D);
    const lat = p.lat + -0.173 * sin(F - 2 * D) - 0.055 * sin(Mm - F - 2 * D) - 0.046 * sin(Mm + F - 2 * D) + 0.033 * sin(F + 2 * D) + 0.017 * sin(2 * Mm + F);
    const dist = p.r - 0.58 * cos(Mm - 2 * D) - 0.46 * cos(2 * D);
    return { lon: norm(lon), lat, dist, helio: dist, earthSun: sun.r, sunLon: sun.lon };
  }
  const el = elements(id, d);
  const { r, v } = orbit(el);
  let p = polar(rect(el, r, v));
  if (id === "jupiter" || id === "saturn") {
    const Mj = norm(elements("jupiter", d).M);
    const Msat = norm(elements("saturn", d).M);
    let dLon = 0;
    let dLat = 0;
    if (id === "jupiter") dLon = -0.332 * sin(2 * Mj - 5 * Msat - 67.6) - 0.056 * sin(2 * Mj - 2 * Msat + 21) + 0.042 * sin(3 * Mj - 5 * Msat + 21) - 0.036 * sin(Mj - 2 * Msat) + 0.022 * cos(Mj - Msat) + 0.023 * sin(2 * Mj - 3 * Msat + 52) - 0.016 * sin(Mj - 5 * Msat - 69);
    else {
      dLon = 0.812 * sin(2 * Mj - 5 * Msat - 67.6) - 0.229 * cos(2 * Mj - 4 * Msat - 2) + 0.119 * sin(Mj - 2 * Msat - 3) + 0.046 * sin(2 * Mj - 6 * Msat - 69) + 0.014 * sin(Mj - 3 * Msat + 32);
      dLat = -0.02 * cos(2 * Mj - 4 * Msat - 2) + 0.018 * sin(2 * Mj - 6 * Msat - 49);
    }
    p = { lon: norm(p.lon + dLon), lat: p.lat + dLat, r: p.r };
  }
  const h = cart(p.lon, p.lat, p.r);
  const g = { x: h.x + sun.x, y: h.y + sun.y, z: h.z };
  const q = polar(g);
  return { lon: q.lon, lat: q.lat, dist: q.r, helio: p.r, earthSun: sun.r, sunLon: sun.lon };
}

const GMST = (jd: number) => norm(280.46061837 + 360.98564736629 * (jd - 2451545));

/** Altitude and azimuth of an ecliptic position for an observer. */
function horizon(lon: number, lat: number, d: number, jd: number, obsLat: number, obsLon: number) {
  const ecl = 23.4393 - 3.563e-7 * d;
  const xe = cos(lon) * cos(lat);
  const ye = sin(lon) * cos(lat) * cos(ecl) - sin(lat) * sin(ecl);
  const ze = sin(lon) * cos(lat) * sin(ecl) + sin(lat) * cos(ecl);
  const ra = norm(Math.atan2(ye, xe) * DEG);
  const dec = Math.atan2(ze, Math.hypot(xe, ye)) * DEG;
  const ha = GMST(jd) + obsLon - ra;
  const sinAlt = sin(obsLat) * sin(dec) + cos(obsLat) * cos(dec) * cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;
  // Bearing from north through east: atan2(sinA, cosA), with sinA = -cos(dec) sin(ha) / cos(alt) and cosA = (sin(dec) - sin(alt) sin(lat)) / (cos(alt) cos(lat)).
  const az = norm(Math.atan2(-cos(dec) * sin(ha), (sin(dec) - sinAlt * sin(obsLat)) / cos(obsLat)) * DEG);
  return { alt, az, ra, dec };
}

const NAMES: Record<BodyId, string> = { moon: "The Moon", mercury: "Mercury", venus: "Venus", mars: "Mars", jupiter: "Jupiter", saturn: "Saturn" };

/** Where one body is, and how it looks, at an instant. */
export function bodyAt(id: BodyId, when: Date, lat = HOME_LATLON.lat, lon = HOME_LATLON.lon): Omit<Body, "rises" | "sets"> {
  const jd = julianDay(when);
  const d = jd - 2451543.5;
  const g = geo(id, d);
  const h = horizon(g.lon, g.lat, d, jd, lat, lon);
  let alt = h.alt;
  // The Moon is near enough that standing on the ground (not at the Earth's centre) lowers it by up to a degree.
  if (id === "moon") alt -= Math.asin(1 / g.dist) * DEG * cos(h.alt);
  // Atmospheric refraction lifts everything near the horizon a little.
  if (alt > -1 && alt < 15) alt += 1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * RAD) / 60;
  const diff = norm(g.lon - g.sunLon);
  const elongation = Math.acos(Math.max(-1, Math.min(1, cos(g.lat) * cos(diff)))) * DEG;
  let illum: number;
  let mag = -12.7;
  if (id === "moon") illum = (1 - cos(elongation)) / 2;
  else {
    const r = g.helio;
    const R = g.earthSun;
    const Dl = g.dist;
    illum = ((r + Dl) ** 2 - R ** 2) / (4 * r * Dl);
    const FV = Math.acos(Math.max(-1, Math.min(1, (r * r + Dl * Dl - R * R) / (2 * r * Dl)))) * DEG;
    const base = 5 * Math.log10(r * Dl);
    mag =
      id === "mercury" ? -0.36 + base + 0.027 * FV + 2.2e-13 * FV ** 6
      : id === "venus" ? -4.34 + base + 0.013 * FV + 4.2e-7 * FV ** 3
      : id === "mars" ? -1.51 + base + 0.016 * FV
      : id === "jupiter" ? -9.25 + base + 0.014 * FV
      : -9.0 + base + 0.044 * FV;
  }
  if (id === "moon") {
    mag = -12.74 + 0.026 * Math.abs(180 - elongation) + 4e-9 * Math.abs(180 - elongation) ** 4;
  }
  const out: Omit<Body, "rises" | "sets"> = { id, name: NAMES[id], alt, az: h.az, illum: Math.max(0, Math.min(1, illum)), waxing: diff > 0 && diff < 180, mag, elongation };
  if (id === "saturn") {
    // How open its rings are: sin B = sin(i) cos(lat) sin(lon - node) - cos(i) sin(lat), with the ring plane's tilt and node.
    const i = 28.06;
    const node = 169.51 + 3.82e-5 * d;
    out.ringTilt = Math.asin(sin(i) * cos(g.lat) * sin(g.lon - node) - cos(i) * sin(g.lat)) * DEG;
  }
  return out;
}

/** The Sun's altitude: below -6 degrees it is dark enough to see the planets properly. */
export function sunAltitude(when: Date, lat = HOME_LATLON.lat, lon = HOME_LATLON.lon) {
  const jd = julianDay(when);
  const d = jd - 2451543.5;
  const s = sunPos(d);
  return horizon(s.lon, 0, d, jd, lat, lon).alt;
}

/** The Sun's altitude and azimuth (from north, through east). */
export function sunAltAz(when: Date, lat = HOME_LATLON.lat, lon = HOME_LATLON.lon) {
  const jd = julianDay(when);
  const d = jd - 2451543.5;
  const s = sunPos(d);
  const h = horizon(s.lon, 0, d, jd, lat, lon);
  return { alt: h.alt, az: h.az };
}

/** Local sidereal time in degrees: which right ascension is on the meridian. */
export const lstDeg = (when: Date, lon = HOME_LATLON.lon) => norm(GMST(julianDay(when)) + lon);

/** The next rising and setting within a day of `from` (the altitude crossing -0.5 degrees, found in 10-minute steps and refined). */
function riseSet(id: BodyId, from: Date, lat: number, lon: number) {
  const f = (t: number) => bodyAt(id, new Date(t), lat, lon).alt + 0.5;
  let rises: Date | undefined;
  let sets: Date | undefined;
  let riseAz: number | undefined;
  let setAz: number | undefined;
  const step = 10 * 60_000;
  let prev = f(from.getTime());
  for (let t = from.getTime() + step; t <= from.getTime() + 25 * 3600_000 && (!rises || !sets); t += step) {
    const cur = f(t);
    if ((prev < 0) !== (cur < 0)) {
      let lo = t - step;
      let hi = t;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        if ((f(mid) < 0) === (prev < 0)) lo = mid;
        else hi = mid;
      }
      if (prev < 0 && !rises) {
        rises = new Date(hi);
        riseAz = bodyAt(id, rises, lat, lon).az;
      }
      if (prev >= 0 && !sets) {
        sets = new Date(hi);
        setAz = bodyAt(id, sets, lat, lon).az;
      }
    }
    prev = cur;
  }
  return { rises, sets, riseAz, setAz };
}

/** The next new moon and full moon after `from`, to within a few minutes. */
export function nextMoons(from: Date) {
  const diff = (t: number) => {
    const d = julianDay(new Date(t)) - 2451543.5;
    return norm(geo("moon", d).lon - sunPos(d).lon);
  };
  let newMoon: Date | undefined;
  let full: Date | undefined;
  const step = 3600_000;
  let prev = diff(from.getTime());
  for (let t = from.getTime() + step; t < from.getTime() + 32 * 86400_000 && (!newMoon || !full); t += step) {
    const cur = diff(t);
    const refine = (target: number) => {
      let lo = t - step;
      let hi = t;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2;
        if (norm180(diff(mid) - target) < 0) lo = mid;
        else hi = mid;
      }
      return new Date(hi);
    };
    if (prev > 300 && cur < 60 && !newMoon) newMoon = refine(0);
    if (prev < 180 && cur >= 180 && !full) full = refine(180);
    prev = cur;
  }
  return { nextNew: newMoon ?? new Date(from.getTime() + 29.53 * 86400_000), nextFull: full ?? new Date(from.getTime() + 14.77 * 86400_000) };
}

/** Hours of the day in the viewer's own clock. */
function eveningAt(from: Date, hour: number) {
  const t = new Date(from);
  t.setHours(hour, 0, 0, 0);
  if (t.getTime() < from.getTime() - 3600_000 * 12) t.setDate(t.getDate() + 1);
  return t;
}

/**
 * Tonight's sky: now if it is already dark, otherwise how it will look at 9 pm. The Moon and the planets worth looking
 * for (above the horizon at that moment, or rising or setting within the night), brightest first.
 */
export function tonightSky(now: Date = new Date(), lat = HOME_LATLON.lat, lon = HOME_LATLON.lon): Sky {
  const darkNow = sunAltitude(now, lat, lon) < -6;
  const when = darkNow ? now : eveningAt(now, 21);
  const sunAlt = sunAltitude(when, lat, lon);
  const ids: BodyId[] = ["moon", "venus", "jupiter", "saturn", "mars", "mercury"];
  const bodies = ids
    .map((id) => ({ ...bodyAt(id, when, lat, lon), ...riseSet(id, when, lat, lon) }) as Body)
    .sort((a, b) => a.mag - b.mag);
  const { nextFull, nextNew } = nextMoons(when);
  const d = julianDay(when) - 2451543.5;
  const age = norm(geo("moon", d).lon - sunPos(d).lon) / 360 * 29.530588853;
  return { when, sunAlt, dark: sunAlt < -6, bodies, moonAge: age, nextFull, nextNew };
}

const POINTS = ["north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast", "south-southeast", "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest", "northwest", "north-northwest"];
export const compass = (az: number) => POINTS[Math.round(norm(az) / 22.5) % 16];
export const heightWords = (alt: number) => (alt < 0 ? "below the horizon" : alt < 12 ? "low" : alt < 35 ? "a third of the way up" : alt < 60 ? "high" : "almost overhead");

/** "Waxing crescent", "Full moon", ... from the Moon's age in days. */
export function moonPhaseName(age: number) {
  const f = age / 29.530588853;
  if (f < 0.03 || f >= 0.97) return "New moon";
  if (f < 0.22) return "Waxing crescent";
  if (f < 0.28) return "First quarter";
  if (f < 0.47) return "Waxing gibbous";
  if (f < 0.53) return "Full moon";
  if (f < 0.72) return "Waning gibbous";
  if (f < 0.78) return "Last quarter";
  return "Waning crescent";
}

/** A short plain-words line about how bright something is. */
export function brightness(mag: number) {
  if (mag < -4) return "the brightest thing in the sky";
  if (mag < -2) return "brighter than any star";
  if (mag < 0) return "as bright as the brightest stars";
  if (mag < 1.5) return "bright, easy to spot";
  return "dim, look carefully";
}
