import { describe, expect, it } from "vitest";
import { syntheticGrid, TEST_TAG } from "../grid/__fixtures__/syntheticGrid";
import type { Extent } from "../grid/grid";
import {
  boulderIndex,
  createSensorLayers,
  hydrogenPpm,
  iceLevel,
  iceProbability,
  SENSOR_FIELD_IDS,
  surfaceTempNow,
  type SensorFields,
} from "./sensors";

describe("simulated sensor models", () => {
  it("boulder index ramps with roughness and slope and stays in 0..1", () => {
    expect(boulderIndex(0, 0)).toBe(0);
    expect(boulderIndex(6, 25)).toBeCloseTo(1);
    expect(boulderIndex(100, 100)).toBe(1);
    expect(boulderIndex(3.5, 5)).toBeCloseTo(0.35);
    expect(boulderIndex(Number.NaN, 5)).toBeNaN();
  });

  it("temperature now goes from annual mean (dark) to annual max (full Sun)", () => {
    expect(surfaceTempNow(100, 300, 0)).toBe(100);
    expect(surfaceTempNow(100, 300, 1)).toBe(300);
    expect(surfaceTempNow(100, 300, 2)).toBe(300);
  });

  it("hydrogen is 100 ppm baseline and 250 ppm where ice is stable everywhere", () => {
    expect(hydrogenPpm(0)).toBe(100);
    expect(hydrogenPpm(1)).toBe(250);
  });

  it("ice probability renormalises over available inputs", () => {
    const dry = iceProbability({
      iceStableFraction: 0,
      iceDepthM: Number.NaN,
      psrFraction: 0,
      cpr: 0.5,
    });
    expect(dry).toBe(0);
    const wet = iceProbability({ iceStableFraction: 1, iceDepthM: 0, psrFraction: 1, cpr: 1.2 });
    expect(wet).toBeCloseTo(1);
    // Without radar the other three weights (0.9) renormalise to 1.
    const noRadar = iceProbability({
      iceStableFraction: 1,
      iceDepthM: 0,
      psrFraction: 1,
      cpr: Number.NaN,
    });
    expect(noRadar).toBeCloseTo(1);
    expect(iceLevel(0.6)).toBe("high");
    expect(iceLevel(0.3)).toBe("medium");
    expect(iceLevel(0.1)).toBe("low");
  });
});

describe("createSensorLayers", () => {
  const grid = syntheticGrid({
    cols: 4,
    rows: 4,
    cellSizeM: 1000,
    fields: { roughness: () => 3.5, slopeP95: () => 5, psrFraction: (i) => (i === 0 ? 1 : 0) },
  });
  const fields = Object.fromEntries(
    SENSOR_FIELD_IDS.map((id) => [
      id,
      {
        id,
        unit: "",
        data: new Float32Array(16).fill(id === "tempMax" ? 300 : 100),
        provenance: { ...TEST_TAG, kind: "measured" as const },
      },
    ]),
  ) as SensorFields;
  const layers = createSensorLayers(grid, fields);

  it("covers all four instruments and gives every layer provenance + confidence", () => {
    expect(new Set(layers.map((l) => l.sensor))).toEqual(
      new Set(["lidar", "sar", "radiometer", "spectrometer"]),
    );
    for (const l of layers) {
      const r = l.getLayer(undefined, 0, { sunNow: new Float32Array(16) });
      expect(r.grid.length).toBe(16);
      expect(["measured", "derived", "simulated"]).toContain(r.provenance.kind);
      expect(["high", "medium", "low"]).toContain(r.confidence);
    }
  });

  it("labels modelled layers as simulated, never measured", () => {
    for (const id of [
      "lidar.boulders",
      "radiometer.tempNow",
      "spectrometer.hydrogen",
      "derived.ice",
    ]) {
      const r = layers.find((l) => l.id === id)!.getLayer();
      expect(r.provenance.kind).toBe("simulated");
    }
  });

  it("masks cells outside the ROI", () => {
    const roi: Extent = [-2000, 0, 0, 2000]; // top-left quadrant: cells 0, 1, 4, 5
    const r = layers.find((l) => l.id === "lidar.boulders")!.getLayer(roi);
    const inside = Array.from(r.grid.entries())
      .filter(([, v]) => !Number.isNaN(v))
      .map(([i]) => i);
    expect(inside).toEqual([0, 1, 4, 5]);
    expect(r.grid[0]).toBeCloseTo(0.35);
  });

  it("time-dependent temperature uses the sunlit fraction from the context", () => {
    const l = layers.find((x) => x.id === "radiometer.tempNow")!;
    const sun = new Float32Array(16);
    sun[3] = 1;
    const r = l.getLayer(undefined, 0, { sunNow: sun });
    expect(r.grid[3]).toBe(300);
    expect(r.grid[2]).toBe(100);
  });
});
