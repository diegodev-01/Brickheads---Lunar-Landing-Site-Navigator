import { describe, expect, it } from "vitest";
import { syntheticEphemeris, syntheticGrid } from "../grid/__fixtures__/syntheticGrid";
import { cellIndexAt, cellsInExtent } from "../grid/grid";
import { buildCellFrames } from "../illumination/illumination";
import {
  achievableRateBps,
  BANDS,
  contactMinutesPerOrbit,
  contactWindows,
  eccentricAnomaly,
  freeSpaceLossDb,
  lookAngles,
  NRHO_9_2_SOUTH,
  oneWayLatencyS,
  orbitElements,
  relayPosition,
  segmentHitsMoon,
} from "./relay";
import { createRelayAccumulator, relayPointSeries } from "./relayGrid";

const HALF_PERIOD_MS = (NRHO_9_2_SOUTH.periodS * 1000) / 2;

describe("relay orbit (Keplerian NRHO proxy)", () => {
  const el = orbitElements(NRHO_9_2_SOUTH);

  it("matches the 6.56-day period and the perilune radius", () => {
    expect(el.a).toBeGreaterThan(30_000);
    expect(el.a).toBeLessThan(40_000);
    expect(el.a * (1 - el.e)).toBeCloseTo(NRHO_9_2_SOUTH.periluneRadiusKm, 6);
  });

  it("solves Kepler's equation", () => {
    for (const [M, e] of [
      [0.3, 0.1],
      [2.5, 0.85],
      [6.0, 0.9],
    ] as const) {
      const E = eccentricAnomaly(M, e);
      expect(E - e * Math.sin(E)).toBeCloseTo(M, 10);
    }
  });

  it("is at perilune over the north pole at the epoch, apolune over the south pole half a period later", () => {
    const p0 = relayPosition(NRHO_9_2_SOUTH, NRHO_9_2_SOUTH.periluneEpochMs);
    expect(p0[2]).toBeCloseTo(NRHO_9_2_SOUTH.periluneRadiusKm, 3);
    const p1 = relayPosition(NRHO_9_2_SOUTH, NRHO_9_2_SOUTH.periluneEpochMs + HALF_PERIOD_MS);
    expect(p1[2]).toBeCloseTo(-el.apoluneRadiusKm, 3);
  });

  it("is seen nearly overhead from the south pole near apolune", () => {
    const p = relayPosition(NRHO_9_2_SOUTH, NRHO_9_2_SOUTH.periluneEpochMs + HALF_PERIOD_MS);
    expect(lookAngles({ lat: -89.5, lon: 0 }, 0, p).elevationDeg).toBeGreaterThan(85);
  });
});

describe("geometry and link budget", () => {
  it("detects Moon occultation of a segment", () => {
    expect(segmentHitsMoon([-5000, 0, 0], [5000, 0, 0])).toBe(true);
    expect(segmentHitsMoon([-5000, 3000, 0], [5000, 3000, 0])).toBe(false);
  });

  it("free-space loss: 1000 km at 2.2 GHz ≈ 159.3 dB, +6 dB per doubling of range", () => {
    expect(freeSpaceLossDb(1000, 2.2)).toBeCloseTo(159.3, 1);
    expect(freeSpaceLossDb(2000, 2.2) - freeSpaceLossDb(1000, 2.2)).toBeCloseTo(6.02, 2);
  });

  it("data rate falls 4× when range doubles", () => {
    expect(achievableRateBps(10_000, BANDS.S) / achievableRateBps(20_000, BANDS.S)).toBeCloseTo(
      4,
      6,
    );
  });

  it("one-way latency includes the Earth–Moon leg (~1.28 s)", () => {
    expect(oneWayLatencyS(60_000, 384_400)).toBeCloseTo(1.482, 3);
  });
});

describe("contact windows", () => {
  const step = 600_000;
  const times = Array.from({ length: 8 }, (_, i) => i * step);

  it("groups consecutive visible samples and keeps peak clearance", () => {
    const vis = [false, true, true, false, true, true, true, false];
    const clr = [0, 2, 5, 0, 1, 9, 3, 0];
    expect(contactWindows(times, vis, clr, step)).toEqual([
      { startMs: step, endMs: 3 * step, maxClearanceDeg: 5 },
      { startMs: 4 * step, endMs: 7 * step, maxClearanceDeg: 9 },
    ]);
  });

  it("closes a window still open at the end; minutes per orbit", () => {
    const vis = [false, false, false, false, false, false, true, true];
    const w = contactWindows(times, vis, new Array<number>(8).fill(1), step);
    expect(w[0]!.endMs).toBe(8 * step);
    // 20 min of contact in an 80-min span whose "orbit" is also 80 min
    expect(contactMinutesPerOrbit(w, 8 * step, (8 * step) / 1000)).toBeCloseTo(20, 9);
    expect(contactMinutesPerOrbit([], 0, 100)).toBe(0);
  });
});

describe("relay over the grid", () => {
  const grid = syntheticGrid({
    cols: 2,
    rows: 2,
    cellSizeM: 1000,
    horizonDeg: (i) => (i === 0 ? 21 : 0), // cell 0 sits in a deep pit (max encodable horizon)
  });
  const eph = syntheticEphemeris({ hours: 24 * 14 });
  const win = { startMs: eph.startMs, endMs: eph.startMs + 13 * 86_400_000 };
  const frames = buildCellFrames(grid, cellsInExtent(grid.geometry));
  const cfg = { orbit: NRHO_9_2_SOUTH, minClearanceDeg: 2 };
  const open = cellIndexAt(grid.geometry, 500, -500)!;

  it("an open polar cell sees the relay most of the time; a pit cell much less", () => {
    const acc = createRelayAccumulator(grid, frames, eph, win, cfg, 1);
    let guard = 0;
    while (!acc.advance(50) && guard++ < 100);
    const r = acc.result();
    expect(r.fraction[open]).toBeGreaterThan(0.6);
    expect(r.fraction[0]).toBeLessThan(r.fraction[open]!);
  });

  it("point series yields contact windows, plausible minutes per orbit and latency", () => {
    const s = relayPointSeries(grid, buildCellFrames(grid, Int32Array.of(open)), eph, win, cfg, 30);
    expect(s.windows.length).toBeGreaterThan(0);
    expect(s.minutesPerOrbit).toBeGreaterThan(60 * 24 * 3); // > 3 days of each 6.6-day orbit
    const lat = s.latencyS.filter((x) => !Number.isNaN(x));
    expect(Math.min(...lat)).toBeGreaterThan(1.28);
    expect(Math.max(...lat)).toBeLessThan(1.6);
  });
});
