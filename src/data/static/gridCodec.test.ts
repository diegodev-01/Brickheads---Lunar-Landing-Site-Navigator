import { describe, expect, it } from "vitest";
import { decodeGrid, type GridManifest } from "./gridCodec";

function build(): { manifest: GridManifest; buf: ArrayBuffer } {
  const cols = 2;
  const rows = 1;
  const n = cols * rows;
  const ids = [
    "elevation",
    "slopeMean",
    "slopeP95",
    "roughness",
    "psrFraction",
    "psrDistance",
    "sunLongTerm",
    "earthLongTerm",
  ];
  const fields: GridManifest["fields"] = [];
  const bytes: number[] = [];
  const prov = { kind: "measured", confidence: "high" as const, source: "t", verified: true };
  for (const id of ids) {
    while (bytes.length % 4) bytes.push(0);
    if (id === "elevation") {
      fields.push({
        id,
        dtype: "i16",
        byteOffset: bytes.length,
        scale: 1,
        offset: 0,
        nodata: -32768,
        unit: "m",
        provenance: prov,
      });
      const v = new Int16Array([-1234, -32768]);
      bytes.push(...new Uint8Array(v.buffer));
    } else {
      fields.push({
        id,
        dtype: "u8",
        byteOffset: bytes.length,
        scale: 0.2,
        offset: 0,
        nodata: 255,
        unit: "deg",
        provenance: prov,
      });
      bytes.push(10, 255);
    }
  }
  while (bytes.length % 4) bytes.push(0);
  fields.push({
    id: "horizon",
    dtype: "u8",
    byteOffset: bytes.length,
    scale: 0.1,
    offset: -4,
    nodata: null,
    unit: "deg",
    provenance: { ...prov, kind: "real" },
  });
  for (let i = 0; i < n * 90; i++) bytes.push(40);
  return {
    manifest: {
      version: 1,
      cellSizeM: 500,
      cols,
      rows,
      extentM: [-500, -250, 500, 250],
      horizon: { bins: 90, binDeg: 4, observerHeightM: 2 },
      fields,
    },
    buf: new Uint8Array(bytes).buffer,
  };
}

describe("decodeGrid", () => {
  it("applies scale/offset, maps nodata to NaN and normalises provenance", () => {
    const { manifest, buf } = build();
    const g = decodeGrid(manifest, buf);
    expect(g.fields.elevation.data[0]).toBe(-1234);
    expect(g.fields.elevation.data[1]).toBeNaN();
    expect(g.fields.slopeP95.data[0]).toBeCloseTo(2);
    expect(g.fields.slopeP95.data[1]).toBeNaN();
    expect(g.horizon.offset + g.horizon.scale * g.horizon.data[0]!).toBeCloseTo(0);
    expect(g.horizon.provenance.kind).toBe("measured");
  });

  it("undoes per-cell delta encoding of horizons", () => {
    const { manifest, buf } = build();
    const h = manifest.fields.find((f) => f.id === "horizon")!;
    const bytes = new Uint8Array(buf);
    // cell 0: q = 40, 41, 39 → deltas 40, 1, 254 (mod 256)
    bytes[h.byteOffset] = 40;
    bytes[h.byteOffset + 1] = 1;
    bytes[h.byteOffset + 2] = 254;
    const g = decodeGrid(
      { ...manifest, horizon: { ...manifest.horizon, storage: "delta-az-u8" } },
      buf,
    );
    expect(Array.from(g.horizon.data.slice(0, 3))).toEqual([40, 41, 39]);
  });

  it("rejects truncated binaries and unknown versions", () => {
    const { manifest, buf } = build();
    expect(() => decodeGrid(manifest, buf.slice(0, 40))).toThrow(/truncated/);
    expect(() => decodeGrid({ ...manifest, version: 2 }, buf)).toThrow(/version/);
  });
});
