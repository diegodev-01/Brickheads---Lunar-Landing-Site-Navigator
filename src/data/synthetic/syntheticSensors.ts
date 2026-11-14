/**
 * Synthetic sensor fields: the offline fallback when public/data/sensors is missing or fails to load.
 * Every field is tagged SIMULATED / low confidence / unverified, so the UI can never present these
 * as measurements. Values are simple physical heuristics from the (real) terrain grid.
 */
import type { AnalysisGrid, ScalarField } from "@/domain/grid/grid";
import type { ProvenanceTag } from "@/domain/provenance";
import { SENSOR_FIELD_IDS, type SensorFieldId, type SensorFields } from "@/domain/sensors/sensors";

const TAG = (what: string): ProvenanceTag => ({
  kind: "simulated",
  confidence: "low",
  source: `Synthetic fallback: ${what} (real sensor file unavailable)`,
  verified: false,
});

export function syntheticSensorFields(grid: AnalysisGrid): SensorFields {
  const n = grid.geometry.cols * grid.geometry.rows;
  const sun = grid.fields.sunLongTerm.data;
  const psr = grid.fields.psrFraction.data;
  const rough = grid.fields.roughness.data;
  const make = (
    id: SensorFieldId,
    unit: string,
    what: string,
    f: (i: number) => number,
  ): ScalarField => ({
    id,
    unit,
    data: Float32Array.from({ length: n }, (_, i) => f(i)),
    provenance: TAG(what),
  });
  const fields: Record<SensorFieldId, ScalarField> = {
    // Cold traps ~40–60 K; sunlit polar ground averages ~200 K: scale with long-term sunlight.
    tempAvg: make(
      "tempAvg",
      "K",
      "mean T from long-term sunlight",
      (i) => 50 + 1.6 * (sun[i] ?? 0),
    ),
    tempMax: make("tempMax", "K", "max T from long-term sunlight", (i) => 70 + 2.3 * (sun[i] ?? 0)),
    iceDepth: make("iceDepth", "m", "ice depth from shadow", (i) =>
      (psr[i] ?? 0) > 0.5 ? 0.1 : Number.NaN,
    ),
    iceStableFraction: make(
      "iceStableFraction",
      "fraction",
      "ice stability from shadow",
      (i) => psr[i] ?? 0,
    ),
    cpr: make("cpr", "ratio", "CPR from roughness", (i) => 0.4 + 0.08 * (rough[i] ?? 0)),
    feo: make("feo", "wt%", "typical highland FeO", () => 5),
    tio2: make("tio2", "wt%", "typical highland TiO2", () => 0.5),
  };
  for (const id of SENSOR_FIELD_IDS) if (!fields[id]) throw new Error(`missing synthetic ${id}`);
  return fields;
}
