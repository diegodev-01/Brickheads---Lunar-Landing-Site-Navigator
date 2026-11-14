/**
 * Provenance: where every value shown in the UI comes from. The app never presents a simulated
 * number as a measurement, so each layer, metric and Pros/Cons item carries one of these tags.
 *
 * - measured:  taken directly from a mission dataset or ephemeris service (e.g. LOLA slope, JPL Horizons).
 * - derived:   computed by us from measured data (e.g. horizon masks, illumination fraction for a date).
 * - simulated: modelled or synthetic (e.g. a sensor stand-in, a simplified relay orbit).
 */

export type ProvenanceKind = "measured" | "derived" | "simulated";
export type Confidence = "high" | "medium" | "low";

export interface ProvenanceTag {
  kind: ProvenanceKind;
  confidence: Confidence;
  /** Human-readable source and citation, e.g. "LOLA LDSM 20 m (Barker et al. 2023)". */
  source: string;
  /** False when the upstream dataset could not be reached and verified with a real request. */
  verified: boolean;
}

/** A value with its provenance attached. */
export interface Tagged<T> {
  value: T;
  provenance: ProvenanceTag;
}

const LEGACY: Record<string, ProvenanceKind> = {
  real: "measured",
  measured: "measured",
  derived: "derived",
  mock: "simulated",
  simulated: "simulated",
};

/** Accepts current and legacy (`real` / `mock`) labels from data files. Unknown → simulated (the safe side). */
export function parseProvenanceKind(raw: string | undefined): ProvenanceKind {
  return (raw ? LEGACY[raw] : undefined) ?? "simulated";
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const KIND_RANK: Record<ProvenanceKind, number> = { simulated: 0, derived: 1, measured: 2 };

/** The weakest confidence among inputs: a result is only as trustworthy as its least certain input. */
export function minConfidence(...values: Confidence[]): Confidence {
  if (values.length === 0) return "low";
  return values.reduce((a, b) => (CONFIDENCE_RANK[b] < CONFIDENCE_RANK[a] ? b : a));
}

/**
 * Provenance of a value computed from several inputs. A computation is never "measured";
 * any simulated input makes the result simulated.
 */
export function combineProvenance(source: string, ...inputs: ProvenanceTag[]): ProvenanceTag {
  const weakestKind = inputs.reduce<ProvenanceKind>(
    (k, p) => (KIND_RANK[p.kind] < KIND_RANK[k] ? p.kind : k),
    "measured",
  );
  return {
    kind: weakestKind === "simulated" ? "simulated" : "derived",
    confidence: minConfidence(...inputs.map((p) => p.confidence)),
    source,
    verified: inputs.every((p) => p.verified),
  };
}

export const PROVENANCE_LABEL: Record<ProvenanceKind, string> = {
  measured: "Measured",
  derived: "Derived",
  simulated: "Simulated",
};
