/**
 * Decodes public/data/grid/{grid.json, grid.bin} (written by scripts/build_grid.py) into an AnalysisGrid.
 * Pure function of (manifest, bytes) so it can run in a Web Worker and be unit-tested without fetch.
 */
import {
  GRID_FIELD_IDS,
  type AnalysisGrid,
  type Extent,
  type GridFieldId,
  type GridValidation,
  type ScalarField,
} from "@/domain/grid/grid";
import { parseProvenanceKind, type Confidence, type ProvenanceTag } from "@/domain/provenance";

type DType = "u8" | "u16" | "i16";

interface ManifestProvenance {
  kind: string;
  confidence: Confidence;
  source: string;
  verified?: boolean;
}

interface ManifestField {
  id: string;
  dtype: DType;
  byteOffset: number;
  scale: number;
  offset: number;
  nodata: number | null;
  unit: string;
  provenance: ManifestProvenance;
}

export interface GridManifest {
  version: number;
  cellSizeM: number;
  cols: number;
  rows: number;
  extentM: Extent;
  horizon: { bins: number; binDeg: number; observerHeightM: number; storage?: string };
  /** Binary file name next to grid.json (default grid.bin). */
  file?: string;
  fields: ManifestField[];
  validation?: GridValidation;
}

const toTag = (p: ManifestProvenance): ProvenanceTag => ({
  kind: parseProvenanceKind(p.kind),
  confidence: p.confidence,
  source: p.source,
  verified: p.verified ?? false,
});

const BYTES: Record<DType, number> = { u8: 1, u16: 2, i16: 2 };

function view(buf: ArrayBuffer, f: ManifestField, n: number): ArrayLike<number> {
  switch (f.dtype) {
    case "u8":
      return new Uint8Array(buf, f.byteOffset, n);
    case "u16":
      return new Uint16Array(buf, f.byteOffset, n);
    case "i16":
      return new Int16Array(buf, f.byteOffset, n);
  }
}

export function decodeGrid(manifest: GridManifest, buf: ArrayBuffer): AnalysisGrid {
  if (manifest.version !== 1) throw new Error(`Unsupported grid version ${manifest.version}`);
  const n = manifest.cols * manifest.rows;
  const byId = new Map(manifest.fields.map((f) => [f.id, f]));
  const size = (f: ManifestField) =>
    f.byteOffset + (f.id === "horizon" ? n * manifest.horizon.bins : n * BYTES[f.dtype]);
  if (manifest.fields.some((f) => size(f) > buf.byteLength))
    throw new Error("grid.bin is truncated");

  const fields = {} as Record<GridFieldId, ScalarField>;
  for (const id of GRID_FIELD_IDS) {
    const f = byId.get(id);
    if (!f) throw new Error(`grid.json is missing field "${id}"`);
    const raw = view(buf, f, n);
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const q = raw[i]!;
      data[i] = q === f.nodata ? Number.NaN : f.offset + f.scale * q;
    }
    fields[id] = { id, unit: f.unit, data, provenance: toTag(f.provenance) };
  }

  const h = byId.get("horizon");
  if (!h) throw new Error('grid.json is missing field "horizon"');
  const bins = manifest.horizon.bins;
  let hz = new Uint8Array(buf, h.byteOffset, n * bins);
  if (manifest.horizon.storage?.startsWith("delta-az-u8")) {
    // Undo the per-cell delta along azimuth (mod 256).
    const out = new Uint8Array(n * bins);
    for (let c = 0; c < n; c++) {
      let acc = 0;
      for (let b = 0; b < bins; b++) {
        acc = (acc + hz[c * bins + b]!) & 255;
        out[c * bins + b] = acc;
      }
    }
    hz = out;
  }

  return {
    geometry: {
      cols: manifest.cols,
      rows: manifest.rows,
      cellSizeM: manifest.cellSizeM,
      extentM: manifest.extentM,
    },
    fields,
    horizon: {
      bins,
      binDeg: manifest.horizon.binDeg,
      offset: h.offset,
      scale: h.scale,
      data: hz,
      observerHeightM: manifest.horizon.observerHeightM,
      provenance: toTag(h.provenance),
    },
    validation: manifest.validation,
  };
}
