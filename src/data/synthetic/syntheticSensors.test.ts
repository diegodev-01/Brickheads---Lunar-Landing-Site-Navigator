import { describe, expect, it } from "vitest";
import { syntheticGrid } from "@/domain/grid/__fixtures__/syntheticGrid";
import { SENSOR_FIELD_IDS } from "@/domain/sensors/sensors";
import { syntheticSensorFields } from "./syntheticSensors";

describe("syntheticSensorFields (offline fallback)", () => {
  const grid = syntheticGrid({
    cols: 2,
    rows: 1,
    fields: { sunLongTerm: (i) => (i === 0 ? 0 : 100), psrFraction: (i) => (i === 0 ? 1 : 0) },
  });
  const f = syntheticSensorFields(grid);

  it("provides every field, all SIMULATED, low confidence and unverified", () => {
    for (const id of SENSOR_FIELD_IDS) {
      expect(f[id].data.length).toBe(2);
      expect(f[id].provenance).toMatchObject({
        kind: "simulated",
        confidence: "low",
        verified: false,
      });
    }
  });

  it("makes permanently shadowed cells cold and icy, sunlit cells warm and dry", () => {
    expect(f.tempMax.data[0]).toBeLessThan(110);
    expect(f.tempMax.data[1]).toBeGreaterThan(200);
    expect(f.iceStableFraction.data[0]).toBe(1);
    expect(f.iceDepth.data[1]).toBeNaN();
  });
});
