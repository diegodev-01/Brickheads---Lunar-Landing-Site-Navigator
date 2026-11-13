/**
 * Scoring configuration. All thresholds are ILLUSTRATIVE DEFAULTS chosen for the demo,
 * not mission requirements. Real missions should plug in their own lander constraints.
 */

export type FactorId = "sunlight" | "earth" | "slope" | "roughness" | "iceAccess";

export const FACTOR_IDS: readonly FactorId[] = [
  "sunlight",
  "earth",
  "slope",
  "roughness",
  "iceAccess",
];

export type Weights = Record<FactorId, number>;

/** Linear ramp: value `best` scores 1, value `worst` scores 0 (works in either direction). */
export interface Ramp {
  best: number;
  worst: number;
}

export interface ScoringConfig {
  ramps: Record<FactorId, Ramp>;
  /** Hard constraints: violating them flags a site "no-go" (shown separately from the score). */
  limits: {
    maxSlopeDeg: number;
    /** A site inside a permanently shadowed region has no solar power. */
    rejectInPsr: boolean;
  };
}

export const DEFAULT_CONFIG: ScoringConfig = {
  ramps: {
    sunlight: { best: 100, worst: 0 }, // % of window with Sun centre above terrain
    earth: { best: 100, worst: 0 }, // % of window with Earth centre above terrain
    slope: { best: 2, worst: 15 }, // mean slope within 100 m, degrees
    roughness: { best: 1, worst: 8 }, // slope std-dev within 200 m, degrees
    // km to nearest permanently shadowed 100 m pixel; small PSRs are common near the pole, so the
    // useful range is short. Distance to large, science-rich PSRs is a post-MVP refinement.
    iceAccess: { best: 0.2, worst: 3 },
  },
  limits: { maxSlopeDeg: 15, rejectInPsr: true },
};

export interface WeightPreset {
  id: string;
  label: string;
  description: string;
  weights: Weights;
}

export const WEIGHT_PRESETS: readonly WeightPreset[] = [
  {
    id: "balanced",
    label: "Balanced",
    description: "Power first, then comms and a safe touchdown.",
    weights: { sunlight: 3, earth: 2, slope: 2, roughness: 1, iceAccess: 1 },
  },
  {
    id: "power",
    label: "Power-first",
    description: "Solar-powered lander that must survive as long as possible.",
    weights: { sunlight: 5, earth: 1, slope: 2, roughness: 1, iceAccess: 0 },
  },
  {
    id: "comms",
    label: "Comms-first",
    description: "No relay satellite: direct-to-Earth link is mission critical.",
    weights: { sunlight: 2, earth: 5, slope: 2, roughness: 1, iceAccess: 0 },
  },
  {
    id: "science",
    label: "Science-first",
    description: "Get close to cold traps that may hold water ice.",
    weights: { sunlight: 2, earth: 1, slope: 1, roughness: 1, iceAccess: 5 },
  },
];

export const DEFAULT_WEIGHTS: Weights = WEIGHT_PRESETS[0]!.weights;
