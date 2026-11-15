/** Regression checks on the COMMITTED sensor layers (public/data/sensors). */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { lonLatToXY } from "@/domain/geo/polarStereo";
import { SENSOR_FIELD_IDS } from "@/domain/sensors/sensors";
import { decodeFields, type FieldManifest } from "./gridCodec";

const dir = new URL("../../../public/data/sensors/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("sensors.json", dir), "utf8")) as FieldManifest & {
  file: string;
};
const raw = gunzipSync(readFileSync(new URL(manifest.file, dir)));
const f = decodeFields(
  manifest,
  raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
  SENSOR_FIELD_IDS,
);
const cellAt = (lat: number, lon: number) => {
  const { x, y } = lonLatToXY({ lat, lon });
  return Math.floor((50_000 - y) / 500) * 200 + Math.floor((x + 50_000) / 500);
};

describe("committed sensor layers", () => {
  it("are tagged with real, verified sources", () => {
    expect(f.tempMax.provenance).toMatchObject({ kind: "measured", verified: true });
    expect(f.cpr.provenance.source).toMatch(/Mini-RF/);
    expect(f.feo.provenance.confidence).toBe("low"); // ~60 km pixels
  });

  it("show Shackleton's floor as a cold trap where ice is stable", () => {
    const i = cellAt(-89.67, 129.78);
    expect(f.tempMax.data[i]).toBeLessThan(110);
    expect(f.iceStableFraction.data[i]).toBeGreaterThan(0.5);
  });

  it("have plausible ranges", () => {
    const max = (a: Float32Array) => a.reduce((m, v) => (Number.isNaN(v) ? m : Math.max(m, v)), 0);
    expect(max(f.tempMax.data)).toBeGreaterThan(250); // sunlit rims
    expect(max(f.tempMax.data)).toBeLessThan(400);
    expect(max(f.feo.data)).toBeLessThan(10); // highlands
  });
});
