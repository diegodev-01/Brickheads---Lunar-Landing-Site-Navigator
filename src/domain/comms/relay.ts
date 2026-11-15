/**
 * Relay communications (SIMULATED). A relay in a southern 9:2 Near-Rectilinear Halo Orbit (NRHO, the
 * Gateway orbit family) spends most of its ~6.6-day period high above the lunar south pole.
 *
 * MVP propagation: a two-body Keplerian ellipse around the Moon with the NRHO's period and perilune radius.
 * Its apolune points at the south pole and its plane contains the Moon's spin axis and the far-side direction
 * (the Earth–Moon L2 side). A real NRHO is a three-body orbit, so this proxy can be off by thousands of km
 * in position. It reproduces the qualitative geometry that matters for coverage (long, high dwell over
 * the south pole, a fast perilune pass over the north). Limits are listed in docs/comms-model.md.
 *
 * Frames: Moon body-fixed (MEAN_ME-like), km. +z = north pole, +x = 0°E, +y = 90°E.
 */
import { toRad } from "../geo/angles";
import { MOON_RADIUS_M } from "../geo/polarStereo";
import type { LonLat } from "../types";

export const MOON_GM_KM3_S2 = 4902.800066;
export const SPEED_OF_LIGHT_KM_S = 299_792.458;

export interface RelayOrbit {
  /** Orbital period, s (9:2 NRHO ≈ 6.56 d). */
  periodS: number;
  /** Perilune radius from the Moon's centre, km. */
  periluneRadiusKm: number;
  /** Body-fixed longitude of the orbit plane on the apolune side (deg). Far side = 180°. */
  planeLonDeg: number;
  /** Time of a perilune passage (UTC ms): sets the orbit phase (arbitrary for the MVP). */
  periluneEpochMs: number;
  /** "south" puts apolune over the south pole. */
  apolune: "south" | "north";
}

export const NRHO_9_2_SOUTH: RelayOrbit = {
  periodS: 6.56 * 86_400,
  periluneRadiusKm: 1737.4 + 3_100,
  planeLonDeg: 180,
  periluneEpochMs: Date.UTC(2026, 10, 1, 0, 0, 0),
  apolune: "south",
};

export interface OrbitElements {
  a: number;
  e: number;
  apoluneRadiusKm: number;
}

/** Semi-major axis from the period (Kepler III), eccentricity from the perilune radius. */
export function orbitElements(o: RelayOrbit): OrbitElements {
  const n = (2 * Math.PI) / o.periodS;
  const a = Math.cbrt(MOON_GM_KM3_S2 / (n * n));
  const e = 1 - o.periluneRadiusKm / a;
  if (!(e > 0 && e < 1))
    throw new Error("relay orbit: perilune radius must be below the semi-major axis");
  return { a, e, apoluneRadiusKm: a * (1 + e) };
}

/** Solve Kepler's equation M = E − e·sin E (Newton, converges in < 10 steps for e < 0.95). */
export function eccentricAnomaly(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

export type Vec3 = [number, number, number];

/** Relay position in the Moon body frame at time t (km). */
export function relayPosition(o: RelayOrbit, tMs: number, el = orbitElements(o)): Vec3 {
  const n = (2 * Math.PI) / o.periodS;
  const dt = (tMs - o.periluneEpochMs) / 1000;
  const M = (((n * dt) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const E = eccentricAnomaly(M, el.e);
  // Perifocal: p̂ toward perilune, q̂ 90° ahead in the direction of motion.
  const xp = el.a * (Math.cos(E) - el.e);
  const yq = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  // Perilune over the opposite pole from apolune; the orbit plane contains the spin axis.
  const pole = o.apolune === "south" ? 1 : -1; // perilune direction = +z for a southern NRHO
  const lon = toRad(o.planeLonDeg);
  const h: Vec3 = [Math.cos(lon), Math.sin(lon), 0]; // in-plane horizontal unit vector (apolune-side lon)
  // p̂ = pole·ẑ ; q̂ = h (moving from perilune toward the plane longitude side)
  return [yq * h[0], yq * h[1], xp * pole];
}

/** Site position (km) on the sphere at height h (m) above the reference radius. */
export function sitePosition(p: LonLat, heightM = 0): Vec3 {
  const r = (MOON_RADIUS_M + heightM) / 1000;
  const la = toRad(p.lat);
  const lo = toRad(p.lon);
  return [r * Math.cos(la) * Math.cos(lo), r * Math.cos(la) * Math.sin(lo), r * Math.sin(la)];
}

export interface LookAngles {
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
}

/** Azimuth (clockwise from local north) / elevation (above the smooth-sphere horizon) / range. */
export function lookAngles(site: LonLat, siteHeightM: number, target: Vec3): LookAngles {
  const s = sitePosition(site, siteHeightM);
  const v: Vec3 = [target[0] - s[0], target[1] - s[1], target[2] - s[2]];
  const range = Math.hypot(v[0], v[1], v[2]);
  const la = toRad(site.lat);
  const lo = toRad(site.lon);
  const e: Vec3 = [-Math.sin(lo), Math.cos(lo), 0];
  const nn: Vec3 = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const u: Vec3 = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const ve = (v[0] * e[0] + v[1] * e[1] + v[2] * e[2]) / range;
  const vn = (v[0] * nn[0] + v[1] * nn[1] + v[2] * nn[2]) / range;
  const vu = (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / range;
  const az = (Math.atan2(ve, vn) * 180) / Math.PI;
  return {
    azimuthDeg: (az + 360) % 360,
    elevationDeg: (Math.asin(Math.max(-1, Math.min(1, vu))) * 180) / Math.PI,
    rangeKm: range,
  };
}

/** True when the straight segment a→b passes through the Moon (sphere of radius R km). */
export function segmentHitsMoon(a: Vec3, b: Vec3, radiusKm = MOON_RADIUS_M / 1000): boolean {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const t = Math.max(0, Math.min(1, -(a[0] * d[0] + a[1] * d[1] + a[2] * d[2]) / dd));
  const c: Vec3 = [a[0] + t * d[0], a[1] + t * d[1], a[2] + t * d[2]];
  return Math.hypot(c[0], c[1], c[2]) < radiusKm;
}

/** Earth position in the Moon body frame (km) from the sub-Earth point and distance. */
export function earthPosition(subEarth: LonLat, distanceKm: number): Vec3 {
  const la = toRad(subEarth.lat);
  const lo = toRad(subEarth.lon);
  return [
    distanceKm * Math.cos(la) * Math.cos(lo),
    distanceKm * Math.cos(la) * Math.sin(lo),
    distanceKm * Math.sin(la),
  ];
}

// ---------------------------------------------------------------------------------------------
// Link parameters (documented, not magic numbers)

export interface BandConfig {
  id: "S" | "X" | "Ka";
  label: string;
  frequencyGHz: number;
  /** Lander transmit EIRP, dBW. */
  landerEirpDbw: number;
  /** Relay receive G/T, dB/K. */
  relayGtDbK: number;
  /** Required Eb/N0 incl. coding, dB. */
  requiredEbN0Db: number;
  /** Implementation + atmospheric (none on the Moon) margin kept in reserve, dB. */
  marginDb: number;
}

/** Illustrative small-lander proximity-link values (order of magnitude of LunaNet / Gateway studies). */
export const BANDS: Record<BandConfig["id"], BandConfig> = {
  S: {
    id: "S",
    label: "S-band (2.2 GHz)",
    frequencyGHz: 2.2,
    landerEirpDbw: 10,
    relayGtDbK: -5,
    requiredEbN0Db: 2.5,
    marginDb: 3,
  },
  X: {
    id: "X",
    label: "X-band (8.4 GHz)",
    frequencyGHz: 8.4,
    landerEirpDbw: 17,
    relayGtDbK: 5,
    requiredEbN0Db: 2.5,
    marginDb: 3,
  },
  Ka: {
    id: "Ka",
    label: "Ka-band (26 GHz)",
    frequencyGHz: 26,
    landerEirpDbw: 25,
    relayGtDbK: 15,
    requiredEbN0Db: 2.5,
    marginDb: 3,
  },
};

/** Free-space path loss, dB: 20·log10(d km) + 20·log10(f GHz) + 92.45. */
export function freeSpaceLossDb(rangeKm: number, frequencyGHz: number): number {
  return 20 * Math.log10(rangeKm) + 20 * Math.log10(frequencyGHz) + 92.45;
}

/**
 * Achievable data rate (bit/s) from the link budget:
 * C/N0 = EIRP + G/T − FSPL + 228.6 (Boltzmann); R = 10^((C/N0 − Eb/N0 − margin)/10).
 */
export function achievableRateBps(rangeKm: number, band: BandConfig): number {
  const cn0 =
    band.landerEirpDbw + band.relayGtDbK - freeSpaceLossDb(rangeKm, band.frequencyGHz) + 228.6;
  return 10 ** ((cn0 - band.requiredEbN0Db - band.marginDb) / 10);
}

/** One-way latency lander → relay → Earth, s (light time only; no processing/queueing delay). */
export function oneWayLatencyS(landerToRelayKm: number, relayToEarthKm: number): number {
  return (landerToRelayKm + relayToEarthKm) / SPEED_OF_LIGHT_KM_S;
}

// ---------------------------------------------------------------------------------------------
// Contact windows

export interface ContactWindow {
  startMs: number;
  endMs: number;
  /** Peak elevation above the local terrain during the window, deg. */
  maxClearanceDeg: number;
}

/** Group a boolean visibility series into contact windows (sample i covers [t_i, t_i + step)). */
export function contactWindows(
  times: number[],
  visible: boolean[],
  clearanceDeg: number[],
  stepMs: number,
): ContactWindow[] {
  const out: ContactWindow[] = [];
  let cur: ContactWindow | null = null;
  for (let i = 0; i < times.length; i++) {
    if (visible[i]) {
      if (!cur)
        cur = { startMs: times[i]!, endMs: times[i]! + stepMs, maxClearanceDeg: clearanceDeg[i]! };
      else {
        cur.endMs = times[i]! + stepMs;
        cur.maxClearanceDeg = Math.max(cur.maxClearanceDeg, clearanceDeg[i]!);
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Contact minutes per orbit, averaged over the window. */
export function contactMinutesPerOrbit(
  windows: ContactWindow[],
  spanMs: number,
  periodS: number,
): number {
  const total = windows.reduce((s, w) => s + (w.endMs - w.startMs), 0);
  return spanMs <= 0 ? 0 : (total / 60_000) * ((periodS * 1000) / spanMs);
}
