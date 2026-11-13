import { describe, expect, it } from "vitest";
import type { EphemerisSeries, HorizonMask, Site } from "../types";
import { horizonAt } from "./horizon";
import { computeConditions, sampleRange, summarizeVisibility } from "./windows";

const mask = (values: number[], stepDeg = 90): HorizonMask => ({
  startAzDeg: 0,
  stepDeg,
  elevationDeg: values,
});

describe("horizonAt", () => {
  it("returns 0° (smooth sphere) without a mask", () => {
    expect(horizonAt(undefined, 123)).toBe(0);
  });

  it("interpolates between bins", () => {
    expect(horizonAt(mask([0, 2, 4, 6]), 45)).toBeCloseTo(1);
    expect(horizonAt(mask([0, 2, 4, 6]), 180)).toBeCloseTo(4);
  });

  it("wraps around 359° → 0°", () => {
    expect(horizonAt(mask([0, 2, 4, 6]), 315)).toBeCloseTo(3); // between 6 (270°) and 0 (360°)
    expect(horizonAt(mask([0, 2, 4, 6]), -45)).toBeCloseTo(3);
    expect(horizonAt(mask([0, 2, 4, 6]), 360)).toBeCloseTo(0);
  });
});

describe("summarizeVisibility", () => {
  const times = [0, 1, 2, 3, 4, 5].map((h) => h * 3_600_000);
  const az = times.map(() => 0);

  it("computes fraction, time to change and longest gap", () => {
    const el = [2, 2, -1, -1, -1, 3];
    const v = summarizeVisibility(
      "sun",
      times,
      az,
      el,
      el.map(() => 0),
      1,
    );
    expect(v.fraction).toBeCloseTo(3 / 6);
    expect(v.visibleAtStart).toBe(true);
    expect(v.hoursToChange).toBe(2); // sets after 2 h
    expect(v.longestGapHours).toBe(3);
    expect(v.meanElevationWhenVisibleDeg).toBeCloseTo(7 / 3);
  });

  it("treats terrain above the body as blocked", () => {
    const el = [1, 1, 1, 1, 1, 1];
    const v = summarizeVisibility("earth", times, az, el, [0, 0, 2, 2, 0, 0], 1);
    expect(v.visible).toEqual([true, true, false, false, true, true]);
  });

  it("reports no change when the body never sets", () => {
    const el = [5, 5, 5, 5, 5, 5];
    const v = summarizeVisibility(
      "sun",
      times,
      az,
      el,
      el.map(() => 0),
      1,
    );
    expect(v.hoursToChange).toBeNull();
    expect(v.longestGapHours).toBe(0);
  });
});

describe("computeConditions", () => {
  // Synthetic ephemeris: Sun circles the horizon at 1.5° elevation-ish; Earth fixed.
  const n = 48;
  const eph: EphemerisSeries = {
    startMs: Date.UTC(2027, 0, 1),
    stepMs: 3_600_000,
    subSolarLon: Array.from({ length: n }, (_, i) => (i * 7.5) % 360),
    subSolarLat: Array.from({ length: n }, () => -1.5),
    subEarthLon: Array.from({ length: n }, () => 0),
    subEarthLat: Array.from({ length: n }, () => -5),
    earthDistanceKm: Array.from({ length: n }, () => 384_400),
    provenance: "mock",
    source: "test",
  };
  const pole: Site = {
    id: "p",
    name: "pole",
    kind: "custom",
    lon: 0,
    lat: -90,
    x: 0,
    y: 0,
    provenance: "mock",
  };

  it("selects samples inside the window", () => {
    const r = sampleRange(eph, {
      startMs: eph.startMs + 3_600_000,
      endMs: eph.startMs + 5 * 3_600_000,
    });
    expect(r).toEqual({ from: 1, to: 5 });
  });

  it("sun is up all the time at the pole on a smooth sphere when sub-solar lat is south", () => {
    const c = computeConditions(pole, eph, {
      startMs: eph.startMs,
      endMs: eph.startMs + 47 * 3_600_000,
    });
    expect(c.sun.fraction).toBe(1);
    expect(c.sun.elevationDeg[0]).toBeCloseTo(1.5, 5);
  });

  it("a 2° terrain wall blocks the low sun everywhere", () => {
    const walled = { ...pole, horizon: mask(Array.from({ length: 4 }, () => 2)) };
    const c = computeConditions(walled, eph, {
      startMs: eph.startMs,
      endMs: eph.startMs + 47 * 3_600_000,
    });
    expect(c.sun.fraction).toBe(0);
  });
});
