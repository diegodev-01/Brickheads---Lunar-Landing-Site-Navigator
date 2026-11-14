/**
 * Illumination (and Earth visibility) over the analysis grid.
 *
 * Model
 * - Sun / Earth direction: sub-solar / sub-Earth points from JPL Horizons (DE441, 1 h step), linearly
 *   interpolated between samples (longitude unwrapped). Error from interpolation < 0.01° (the sub-solar
 *   point moves ~0.5°/h, smoothly).
 * - Shadowing: horizon-based. Each cell has a terrain horizon mask, ray-marched OFFLINE over the LOLA DEM
 *   (scripts/build_grid.py). At run time we only compare the body's elevation with the mask at its azimuth.
 * - Partial disc: the visible fraction of the disc is approximated linearly across its diameter:
 *     f = clamp((el − horizon) / (2·r) + 0.5, 0, 1),   r_sun = 0.267°, r_earth ≈ 0.95°.
 *   (The exact circular-segment area differs by < 0.06 at any point; the time average is nearly identical.)
 * - Earth includes the ~1° topocentric parallax (localSky with distance).
 */
import { toRad } from "../geo/angles";
import { MOON_RADIUS_M } from "../geo/polarStereo";
import { cellHorizonAt, cellLonLat, type AnalysisGrid } from "../grid/grid";
import type { Body, EphemerisSeries, LonLat, TimeWindow } from "../types";

export const SUN_RADIUS_DEG = 0.267;
/** Earth's angular radius from the Moon varies 0.90–1.0°; mean value used. */
export const EARTH_RADIUS_DEG = 0.95;

export interface BodyDirection {
  /** Sub-body point on the Moon. */
  subPoint: LonLat;
  /** Body distance from the Moon centre, km (Infinity for the Sun). */
  distanceKm: number;
}

function lerpLon(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  const v = a + d * t;
  return ((v % 360) + 360) % 360;
}

/** Sun or Earth direction at an arbitrary time inside the ephemeris coverage (clamped at the ends). */
export function bodyDirection(eph: EphemerisSeries, body: Body, tMs: number): BodyDirection {
  const n = eph.subSolarLon.length;
  const pos = Math.min(n - 1, Math.max(0, (tMs - eph.startMs) / eph.stepMs));
  const i0 = Math.min(n - 2, Math.floor(pos));
  const t = pos - i0;
  if (body === "sun") {
    return {
      subPoint: {
        lon: lerpLon(eph.subSolarLon[i0]!, eph.subSolarLon[i0 + 1]!, t),
        lat: eph.subSolarLat[i0]! * (1 - t) + eph.subSolarLat[i0 + 1]! * t,
      },
      distanceKm: Number.POSITIVE_INFINITY,
    };
  }
  return {
    subPoint: {
      lon: lerpLon(eph.subEarthLon[i0]!, eph.subEarthLon[i0 + 1]!, t),
      lat: eph.subEarthLat[i0]! * (1 - t) + eph.subEarthLat[i0 + 1]! * t,
    },
    distanceKm: eph.earthDistanceKm[i0]! * (1 - t) + eph.earthDistanceKm[i0 + 1]! * t,
  };
}

/** Linear partial-disc visibility: 0 = fully hidden, 1 = fully above the terrain. */
export function discFraction(elevationDeg: number, horizonDeg: number, radiusDeg: number): number {
  const f = (elevationDeg - horizonDeg) / (2 * radiusDeg) + 0.5;
  return f <= 0 ? 0 : f >= 1 ? 1 : f;
}

/**
 * Precomputed local frames for a set of cells (east, north, up unit vectors), so the hot loop is
 * three dot products and two inverse trig calls per cell and time step.
 */
export interface CellFrames {
  cells: Int32Array;
  /** 9 floats per cell: e(3), n(3), u(3). */
  basis: Float64Array;
}

export function buildCellFrames(grid: AnalysisGrid, cells: Int32Array): CellFrames {
  const basis = new Float64Array(cells.length * 9);
  for (let k = 0; k < cells.length; k++) {
    const { lon, lat } = cellLonLat(grid.geometry, cells[k]!);
    const la = toRad(lat);
    const lo = toRad(lon);
    const o = k * 9;
    basis[o] = -Math.sin(lo);
    basis[o + 1] = Math.cos(lo);
    basis[o + 2] = 0;
    basis[o + 3] = -Math.sin(la) * Math.cos(lo);
    basis[o + 4] = -Math.sin(la) * Math.sin(lo);
    basis[o + 5] = Math.cos(la);
    basis[o + 6] = Math.cos(la) * Math.cos(lo);
    basis[o + 7] = Math.cos(la) * Math.sin(lo);
    basis[o + 8] = Math.sin(la);
  }
  return { cells, basis };
}

const RAD2DEG = 180 / Math.PI;

/**
 * Visible disc fraction of a body for each cell at one instant (a "frame" for the time scrubber).
 * Optionally also writes elevation/azimuth per cell.
 */
export function visibilitySnapshot(
  grid: AnalysisGrid,
  frames: CellFrames,
  dir: BodyDirection,
  radiusDeg: number,
  out = new Float32Array(frames.cells.length),
): Float32Array {
  const la = toRad(dir.subPoint.lat);
  const lo = toRad(dir.subPoint.lon);
  const sx = Math.cos(la) * Math.cos(lo);
  const sy = Math.cos(la) * Math.sin(lo);
  const sz = Math.sin(la);
  const finite = Number.isFinite(dir.distanceKm);
  const d = finite ? dir.distanceKm * 1000 : 1;
  const r = MOON_RADIUS_M;
  const { basis, cells } = frames;
  const h = grid.horizon;
  for (let k = 0; k < cells.length; k++) {
    const o = k * 9;
    let vx = sx;
    let vy = sy;
    let vz = sz;
    if (finite) {
      vx = d * sx - r * basis[o + 6]!;
      vy = d * sy - r * basis[o + 7]!;
      vz = d * sz - r * basis[o + 8]!;
      const norm = Math.hypot(vx, vy, vz);
      vx /= norm;
      vy /= norm;
      vz /= norm;
    }
    const ve = vx * basis[o]! + vy * basis[o + 1]! + vz * basis[o + 2]!;
    const vn = vx * basis[o + 3]! + vy * basis[o + 4]! + vz * basis[o + 5]!;
    const vu = vx * basis[o + 6]! + vy * basis[o + 7]! + vz * basis[o + 8]!;
    const el = Math.asin(vu > 1 ? 1 : vu < -1 ? -1 : vu) * RAD2DEG;
    // Fast reject: below the lowest representable horizon minus the disc radius is never visible,
    // and the Sun never gets high enough at the pole to clear the max horizon by much.
    if (el + radiusDeg < h.offset) {
      out[k] = 0;
      continue;
    }
    const az = Math.atan2(ve, vn) * RAD2DEG;
    out[k] = discFraction(el, cellHorizonAt(h, cells[k]!, az), radiusDeg);
  }
  return out;
}

export interface WindowVisibility {
  cells: Int32Array;
  /** Mean visible disc fraction over the window, 0..1, per cell. */
  fraction: Float32Array;
  /** Longest continuous stretch with < 50 % of the disc visible, hours, per cell. */
  longestGapHours: Float32Array;
  /** Disc fraction at the window start, per cell. */
  atStart: Float32Array;
  samples: number;
  stepHours: number;
}

/** Time-averaged visibility per cell over a window, sampled every `stepHours`. */
export function visibilityOverWindow(
  grid: AnalysisGrid,
  frames: CellFrames,
  eph: EphemerisSeries,
  win: TimeWindow,
  body: Body,
  stepHours = 1,
): WindowVisibility {
  const radius = body === "sun" ? SUN_RADIUS_DEG : EARTH_RADIUS_DEG;
  const n = frames.cells.length;
  const stepMs = stepHours * 3_600_000;
  const samples = Math.max(1, Math.floor((win.endMs - win.startMs) / stepMs) + 1);
  const sum = new Float32Array(n);
  const run = new Float32Array(n);
  const longest = new Float32Array(n);
  const atStart = new Float32Array(n);
  const frame = new Float32Array(n);
  for (let s = 0; s < samples; s++) {
    visibilitySnapshot(
      grid,
      frames,
      bodyDirection(eph, body, win.startMs + s * stepMs),
      radius,
      frame,
    );
    if (s === 0) atStart.set(frame);
    for (let k = 0; k < n; k++) {
      const f = frame[k]!;
      sum[k]! += f;
      if (f < 0.5) {
        run[k]! += stepHours;
        if (run[k]! > longest[k]!) longest[k] = run[k]!;
      } else run[k] = 0;
    }
  }
  for (let k = 0; k < n; k++) sum[k]! /= samples;
  return {
    cells: frames.cells,
    fraction: sum,
    longestGapHours: longest,
    atStart,
    samples,
    stepHours,
  };
}

export interface PointSeries {
  times: number[];
  elevationDeg: number[];
  azimuthDeg: number[];
  horizonDeg: number[];
  /** Visible disc fraction per sample, 0..1. */
  visible: number[];
  /** Mean of `visible`. */
  fraction: number;
}

/** Time series for one cell (the "illuminated % over time" chart and the horizon panorama). */
export function pointSeries(
  grid: AnalysisGrid,
  cell: number,
  eph: EphemerisSeries,
  win: TimeWindow,
  body: Body,
  stepHours = 1,
): PointSeries {
  const frames = buildCellFrames(grid, Int32Array.of(cell));
  const radius = body === "sun" ? SUN_RADIUS_DEG : EARTH_RADIUS_DEG;
  const b = frames.basis;
  const out: PointSeries = {
    times: [],
    elevationDeg: [],
    azimuthDeg: [],
    horizonDeg: [],
    visible: [],
    fraction: 0,
  };
  const stepMs = stepHours * 3_600_000;
  for (let t = win.startMs; t <= win.endMs; t += stepMs) {
    const dir = bodyDirection(eph, body, t);
    const la = toRad(dir.subPoint.lat);
    const lo = toRad(dir.subPoint.lon);
    let v = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    if (Number.isFinite(dir.distanceKm)) {
      const d = dir.distanceKm * 1000;
      v = [
        d * v[0]! - MOON_RADIUS_M * b[6]!,
        d * v[1]! - MOON_RADIUS_M * b[7]!,
        d * v[2]! - MOON_RADIUS_M * b[8]!,
      ];
      const nrm = Math.hypot(v[0]!, v[1]!, v[2]!);
      v = v.map((c) => c / nrm);
    }
    const ve = v[0]! * b[0]! + v[1]! * b[1]! + v[2]! * b[2]!;
    const vn = v[0]! * b[3]! + v[1]! * b[4]! + v[2]! * b[5]!;
    const vu = v[0]! * b[6]! + v[1]! * b[7]! + v[2]! * b[8]!;
    const el = Math.asin(Math.max(-1, Math.min(1, vu))) * RAD2DEG;
    const az = (((Math.atan2(ve, vn) * RAD2DEG) % 360) + 360) % 360;
    const hz = cellHorizonAt(grid.horizon, cell, az);
    out.times.push(t);
    out.elevationDeg.push(el);
    out.azimuthDeg.push(az);
    out.horizonDeg.push(hz);
    out.visible.push(discFraction(el, hz, radius));
  }
  out.fraction = out.visible.reduce((a, c) => a + c, 0) / Math.max(1, out.visible.length);
  return out;
}
