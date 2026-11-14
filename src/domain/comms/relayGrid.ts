/**
 * Relay contact over the analysis grid: for each cell, the share of the window during which the relay
 * is above the cell's terrain horizon (plus a clearance margin) AND can itself see Earth, and the longest gap.
 * Mirrors illumination's incremental accumulator so the worker can slice and yield.
 */
import { cellHorizonAt, type AnalysisGrid } from "../grid/grid";
import { bodyDirection, type CellFrames } from "../illumination/illumination";
import type { EphemerisSeries, TimeWindow } from "../types";
import {
  contactMinutesPerOrbit,
  contactWindows,
  earthPosition,
  oneWayLatencyS,
  orbitElements,
  relayPosition,
  segmentHitsMoon,
  type ContactWindow,
  type RelayOrbit,
  type Vec3,
} from "./relay";

export interface RelayLinkConfig {
  orbit: RelayOrbit;
  /** Required elevation above the local terrain horizon, deg (antenna pattern / multipath margin). */
  minClearanceDeg: number;
}

/** Relay positions and relay→Earth visibility for each sample of a window (cell-independent). */
export interface RelayTrack {
  times: number[];
  pos: Vec3[];
  earthVisible: boolean[];
  relayEarthKm: number[];
}

export function relayTrack(
  cfg: RelayLinkConfig,
  eph: EphemerisSeries,
  win: TimeWindow,
  stepMs: number,
): RelayTrack {
  const el = orbitElements(cfg.orbit);
  const t: RelayTrack = { times: [], pos: [], earthVisible: [], relayEarthKm: [] };
  for (let tm = win.startMs; tm <= win.endMs; tm += stepMs) {
    const p = relayPosition(cfg.orbit, tm, el);
    const ed = bodyDirection(eph, "earth", tm);
    const e = earthPosition(ed.subPoint, ed.distanceKm);
    t.times.push(tm);
    t.pos.push(p);
    t.earthVisible.push(!segmentHitsMoon(p, e));
    t.relayEarthKm.push(Math.hypot(e[0] - p[0], e[1] - p[1], e[2] - p[2]));
  }
  return t;
}

const RAD2DEG = 180 / Math.PI;
const R_KM = 1737.4;

/** Elevation above terrain (deg) of the relay for each cell at one sample; −Infinity when the relay can't see Earth. */
export function relayClearanceSnapshot(
  grid: AnalysisGrid,
  frames: CellFrames,
  relay: Vec3,
  out = new Float32Array(frames.cells.length),
): Float32Array {
  const { basis, cells } = frames;
  for (let k = 0; k < cells.length; k++) {
    const o = k * 9;
    // site = R·û ; v = relay − site
    const vx = relay[0] - R_KM * basis[o + 6]!;
    const vy = relay[1] - R_KM * basis[o + 7]!;
    const vz = relay[2] - R_KM * basis[o + 8]!;
    const inv = 1 / Math.sqrt(vx * vx + vy * vy + vz * vz);
    const ve = (vx * basis[o]! + vy * basis[o + 1]! + vz * basis[o + 2]!) * inv;
    const vn = (vx * basis[o + 3]! + vy * basis[o + 4]! + vz * basis[o + 5]!) * inv;
    const vu = (vx * basis[o + 6]! + vy * basis[o + 7]! + vz * basis[o + 8]!) * inv;
    const el = Math.asin(vu > 1 ? 1 : vu < -1 ? -1 : vu) * RAD2DEG;
    if (el < frames.minHorizon[k]! - 1) {
      out[k] = el - frames.minHorizon[k]!; // clearly below terrain: skip the azimuth lookup
      continue;
    }
    const az = Math.atan2(ve, vn) * RAD2DEG;
    out[k] = el - cellHorizonAt(grid.horizon, cells[k]!, az);
  }
  return out;
}

export interface RelayWindowResult {
  /** Share of samples with contact, per cell. */
  fraction: Float32Array;
  /** Longest stretch without contact, hours, per cell. */
  longestGapHours: Float32Array;
  samples: number;
}

export interface RelayAccumulator {
  readonly samples: number;
  readonly done: number;
  advance(n: number): boolean;
  result(): RelayWindowResult;
}

export function createRelayAccumulator(
  grid: AnalysisGrid,
  frames: CellFrames,
  eph: EphemerisSeries,
  win: TimeWindow,
  cfg: RelayLinkConfig,
  stepHours = 1,
): RelayAccumulator {
  const stepMs = stepHours * 3_600_000;
  const track = relayTrack(cfg, eph, win, stepMs);
  const n = frames.cells.length;
  const samples = track.times.length;
  const count = new Float32Array(n);
  const run = new Float32Array(n);
  const longest = new Float32Array(n);
  const frame = new Float32Array(n);
  let done = 0;
  return {
    samples,
    get done() {
      return done;
    },
    advance(k: number) {
      const stop = Math.min(samples, done + k);
      for (; done < stop; done++) {
        const earthOk = track.earthVisible[done]!;
        if (earthOk) relayClearanceSnapshot(grid, frames, track.pos[done]!, frame);
        for (let c = 0; c < n; c++) {
          const ok = earthOk && frame[c]! >= cfg.minClearanceDeg;
          if (ok) {
            count[c]! += 1;
            run[c] = 0;
          } else {
            run[c]! += stepHours;
            if (run[c]! > longest[c]!) longest[c] = run[c]!;
          }
        }
      }
      return done >= samples;
    },
    result() {
      const fraction = new Float32Array(n);
      const d = Math.max(1, done);
      for (let c = 0; c < n; c++) fraction[c] = count[c]! / d;
      return { fraction, longestGapHours: longest.slice(), samples: done };
    },
  };
}

export interface RelayPointSeries {
  times: number[];
  /** Relay elevation above the local terrain horizon, deg. */
  clearanceDeg: number[];
  /** Contact = above terrain + margin AND relay sees Earth. */
  contact: boolean[];
  rangeKm: number[];
  /** One-way light time lander → relay → Earth, s (NaN when no contact). */
  latencyS: number[];
  windows: ContactWindow[];
  minutesPerOrbit: number;
  stepMs: number;
}

/** Fine-step relay series for one cell: contact windows, latency, range (for the comms timeline). */
export function relayPointSeries(
  grid: AnalysisGrid,
  frames: CellFrames,
  eph: EphemerisSeries,
  win: TimeWindow,
  cfg: RelayLinkConfig,
  stepMinutes = 10,
): RelayPointSeries {
  const stepMs = stepMinutes * 60_000;
  const track = relayTrack(cfg, eph, win, stepMs);
  const one = new Float32Array(1);
  const out: RelayPointSeries = {
    times: track.times,
    clearanceDeg: [],
    contact: [],
    rangeKm: [],
    latencyS: [],
    windows: [],
    minutesPerOrbit: 0,
    stepMs,
  };
  const b = frames.basis;
  const site: Vec3 = [R_KM * b[6]!, R_KM * b[7]!, R_KM * b[8]!];
  for (let i = 0; i < track.times.length; i++) {
    const p = track.pos[i]!;
    relayClearanceSnapshot(grid, frames, p, one);
    const range = Math.hypot(p[0] - site[0], p[1] - site[1], p[2] - site[2]);
    const ok = track.earthVisible[i]! && one[0]! >= cfg.minClearanceDeg;
    out.clearanceDeg.push(one[0]!);
    out.contact.push(ok);
    out.rangeKm.push(range);
    out.latencyS.push(ok ? oneWayLatencyS(range, track.relayEarthKm[i]!) : Number.NaN);
  }
  out.windows = contactWindows(out.times, out.contact, out.clearanceDeg, stepMs);
  out.minutesPerOrbit = contactMinutesPerOrbit(
    out.windows,
    win.endMs - win.startMs + stepMs,
    cfg.orbit.periodS,
  );
  return out;
}
