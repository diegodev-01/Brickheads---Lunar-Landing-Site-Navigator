import { describe, expect, it } from "vitest";
import { localSky } from "../ephemeris/localSky";
import { syntheticEphemeris, syntheticGrid } from "../grid/__fixtures__/syntheticGrid";
import { cellIndexAt, cellLonLat, cellsInExtent } from "../grid/grid";
import {
  bodyDirection,
  buildCellFrames,
  discFraction,
  pointSeries,
  SUN_RADIUS_DEG,
  visibilityOverWindow,
  visibilitySnapshot,
} from "./illumination";

describe("discFraction", () => {
  it("is 0 below, 1 above and 0.5 with the centre on the horizon", () => {
    expect(discFraction(-1, 0, 0.267)).toBe(0);
    expect(discFraction(1, 0, 0.267)).toBe(1);
    expect(discFraction(2, 2, 0.267)).toBeCloseTo(0.5);
    expect(discFraction(0.1335, 0, 0.267)).toBeCloseTo(0.75);
  });
});

describe("bodyDirection", () => {
  it("interpolates sub-solar longitude across the 360°→0° seam", () => {
    const eph = syntheticEphemeris({ hours: 3 });
    eph.subSolarLon = [359, 1, 3];
    const d = bodyDirection(eph, "sun", eph.startMs + 0.5 * eph.stepMs);
    expect(d.subPoint.lon).toBeCloseTo(0, 9);
    expect(d.distanceKm).toBe(Infinity);
  });

  it("clamps outside the coverage", () => {
    const eph = syntheticEphemeris({ hours: 3 });
    expect(bodyDirection(eph, "sun", eph.startMs - 1e9).subPoint.lon).toBe(eph.subSolarLon[0]);
  });
});

describe("visibilitySnapshot", () => {
  // 20 × 20 km grid at the pole, 1 km cells.
  const wallCell = 0;
  const grid = syntheticGrid({
    cols: 20,
    rows: 20,
    cellSizeM: 1000,
    horizonDeg: (i) => (i === wallCell ? 20 : 0),
  });
  const cells = cellsInExtent(grid.geometry);
  const frames = buildCellFrames(grid, cells);

  it("matches localSky + horizon on every cell (flat horizon)", () => {
    const eph = syntheticEphemeris({ hours: 2, sunLat: 0.4 });
    const dir = bodyDirection(eph, "sun", eph.startMs);
    const out = visibilitySnapshot(grid, frames, dir, SUN_RADIUS_DEG);
    for (const idx of [5, 77, 210, 399]) {
      const sky = localSky(cellLonLat(grid.geometry, idx), dir.subPoint);
      const horizon = idx === wallCell ? 20 : 0;
      expect(out[idx]).toBeCloseTo(discFraction(sky.elevationDeg, horizon, SUN_RADIUS_DEG), 5);
    }
  });

  it("keeps a cell behind a high wall dark and lights the open cells when the Sun is up", () => {
    // South pole: the Sun is UP when the sub-solar latitude is negative (elevation ≈ −subLat).
    const eph = syntheticEphemeris({ hours: 2, sunLat: -1.5 });
    const out = visibilitySnapshot(
      grid,
      frames,
      bodyDirection(eph, "sun", eph.startMs),
      SUN_RADIUS_DEG,
    );
    expect(out[wallCell]).toBe(0);
    const centre = cellIndexAt(grid.geometry, 0, 0)!;
    expect(out[centre]).toBe(1);
  });

  it("darkens everything when the Sun is well below the horizon", () => {
    const eph = syntheticEphemeris({ hours: 2, sunLat: 1.5 });
    const out = visibilitySnapshot(
      grid,
      frames,
      bodyDirection(eph, "sun", eph.startMs),
      SUN_RADIUS_DEG,
    );
    expect(Math.max(...out)).toBe(0);
  });

  it("applies Earth parallax like localSky", () => {
    const eph = syntheticEphemeris({ hours: 2 });
    eph.subEarthLat = [0.6, 0.6];
    const dir = bodyDirection(eph, "earth", eph.startMs);
    const idx = 123;
    const sky = localSky(cellLonLat(grid.geometry, idx), dir.subPoint, dir.distanceKm);
    const s = pointSeries(grid, idx, eph, { startMs: eph.startMs, endMs: eph.startMs }, "earth");
    expect(s.elevationDeg[0]).toBeCloseTo(sky.elevationDeg, 6);
    expect(s.azimuthDeg[0]).toBeCloseTo(sky.azimuthDeg, 6);
  });
});

describe("visibilityOverWindow", () => {
  it("averages the disc fraction and finds the longest night", () => {
    const grid = syntheticGrid({ cols: 2, rows: 2, cellSizeM: 1000 });
    // Sun up (sub-solar lat −2°) for hours 0–9, down (+2°) for 10–19, up again for 20–23.
    const eph = syntheticEphemeris({ hours: 24, sunLat: (i) => (i >= 10 && i < 20 ? 2 : -2) });
    const frames = buildCellFrames(grid, cellsInExtent(grid.geometry));
    const w = visibilityOverWindow(
      grid,
      frames,
      eph,
      { startMs: eph.startMs, endMs: eph.startMs + 23 * 3_600_000 },
      "sun",
    );
    expect(w.samples).toBe(24);
    expect(w.fraction[0]).toBeCloseTo(14 / 24, 5);
    expect(w.longestGapHours[0]).toBe(10);
    expect(w.atStart[0]).toBe(1);
  });
});
