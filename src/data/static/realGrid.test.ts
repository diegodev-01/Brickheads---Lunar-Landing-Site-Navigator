/** Regression checks on the COMMITTED grid (public/data/grid), decoded exactly as the app does. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { lonLatToXY } from "@/domain/geo/polarStereo";
import { cellIndexAt, cellsInExtent } from "@/domain/grid/grid";
import { buildCellFrames, visibilityOverWindow } from "@/domain/illumination/illumination";
import type { EphemerisSeries } from "@/domain/types";
import { decodeGrid, type GridManifest } from "./gridCodec";

const dir = new URL("../../../public/data/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("grid/grid.json", dir), "utf8")) as GridManifest;
const raw = gunzipSync(readFileSync(new URL(`grid/${manifest.file}`, dir)));
const grid = decodeGrid(
  manifest,
  raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
);

describe("committed analysis grid", () => {
  it("has the expected shape, ranges and provenance", () => {
    expect(grid.geometry.cols * grid.geometry.rows).toBe(40_000);
    const slope = grid.fields.slopeP95.data;
    const max = slope.reduce((m, v) => (Number.isNaN(v) ? m : Math.max(m, v)), 0);
    expect(max).toBeGreaterThan(20); // crater walls
    expect(max).toBeLessThan(51); // u8 × 0.2° ceiling
    expect(grid.fields.psrFraction.provenance.kind).toBe("measured");
    expect(grid.horizon.provenance.kind).toBe("derived");
  });

  it("keeps the Shackleton crater floor in permanent shadow", () => {
    const { x, y } = lonLatToXY({ lat: -89.67, lon: 129.78 }); // IAU centre
    const idx = cellIndexAt(grid.geometry, x, y)!;
    expect(grid.fields.psrFraction.data[idx]).toBeGreaterThan(0.9);

    const f = JSON.parse(readFileSync(new URL("ephemeris.json", dir), "utf8"));
    const eph: EphemerisSeries = {
      startMs: Date.parse(f.start),
      stepMs: f.stepHours * 3_600_000,
      subSolarLon: f.subSolarLon,
      subSolarLat: f.subSolarLat,
      subEarthLon: f.subEarthLon,
      subEarthLat: f.subEarthLat,
      earthDistanceKm: f.earthDistanceKm,
      provenance: "measured",
      source: f.source,
    };
    const frames = buildCellFrames(grid, Int32Array.of(idx));
    const w = visibilityOverWindow(
      grid,
      frames,
      eph,
      { startMs: Date.UTC(2027, 0, 1), endMs: Date.UTC(2027, 1, 1) },
      "sun",
      6,
    );
    expect(w.fraction[0]).toBe(0);
  });

  it("has no missing cells in the horizon or elevation", () => {
    const all = cellsInExtent(grid.geometry);
    expect(all.length).toBe(40_000);
    expect(grid.fields.elevation.data.some((v) => Number.isNaN(v))).toBe(false);
  });
});
