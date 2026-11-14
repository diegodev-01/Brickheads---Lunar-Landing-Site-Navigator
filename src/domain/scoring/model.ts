/**
 * Cell scoring configuration: hard gates, factor curves, weight presets. All values are ILLUSTRATIVE
 * defaults for a small robotic lander, not mission requirements. Math: docs/scoring-model.md.
 */
import type { Breakpoints } from "./piecewise";

export const FACTORS = ["safety", "science", "comms", "power"] as const;
export type Factor = (typeof FACTORS)[number];
export type FactorWeights = Record<Factor, number>;

export const FACTOR_LABEL: Record<Factor, string> = {
  safety: "Landing safety",
  science: "Science value",
  comms: "Connectivity",
  power: "Power & thermal",
};

export type SlopeTheta = 5 | 8 | 10 | 15;
export const SLOPE_THETAS: readonly SlopeTheta[] = [5, 8, 10, 15];

export interface GateConfig {
  slope: {
    enabled: boolean;
    thetaDeg: SlopeTheta;
    /** Lander-scale: required flat-circle radius. */
    radiusM: number;
    /** "lander": flat circle ≥ radius at ≤ θ (default). "p95": literal 95th-percentile slope ≤ θ. */
    mode: "lander" | "p95";
  };
  roughness: { enabled: boolean; maxDeg: number };
  boulders: { enabled: boolean; max: number };
  /** Fails when there is no Earth contact and no relay contact at all in the window. */
  comms: { enabled: boolean };
  /** Fails when the Sun is never visible in the window (off by default). */
  darkness: { enabled: boolean };
}

export interface CurveConfig {
  safetyRadius: Breakpoints; // x in multiples of the gate radius R
  roughness: Breakpoints;
  boulders: Breakpoints;
  psrDistanceKm: Breakpoints;
  iceNearby: Breakpoints;
  commsFraction: Breakpoints;
  commsGapH: Breakpoints;
  sunFraction: Breakpoints;
  nightH: Breakpoints;
}

export interface ScoringModelConfig {
  gates: GateConfig;
  curves: CurveConfig;
  /** Sub-weights inside each factor (each group sums to 1). */
  sub: {
    safety: { radius: number; roughness: number; boulders: number };
    science: { psr: number; ice: number };
    comms: { fraction: number; gap: number };
    power: { sun: number; night: number };
  };
  /** Radius for the "ice nearby" neighbourhood, km. */
  iceNeighbourhoodKm: number;
}

export function defaultModelConfig(): ScoringModelConfig {
  return {
    gates: {
      slope: { enabled: true, thetaDeg: 5, radiusM: 100, mode: "lander" },
      roughness: { enabled: true, maxDeg: 4 },
      boulders: { enabled: true, max: 0.6 },
      comms: { enabled: true },
      darkness: { enabled: false },
    },
    curves: {
      safetyRadius: [
        [1, 0.4],
        [2, 0.8],
        [4, 1],
      ],
      roughness: [
        [1, 1],
        [2, 0.7],
        [4, 0],
      ],
      boulders: [
        [0, 1],
        [0.6, 0],
      ],
      psrDistanceKm: [
        [0.5, 1],
        [2, 0.6],
        [5, 0.1],
        [10, 0],
      ],
      iceNearby: [
        [0, 0],
        [0.5, 0.8],
        [1, 1],
      ],
      commsFraction: [
        [0, 0],
        [0.3, 0.5],
        [0.7, 0.9],
        [1, 1],
      ],
      commsGapH: [
        [0, 1],
        [24, 0.8],
        [72, 0.5],
        [168, 0.2],
        [336, 0],
      ],
      sunFraction: [
        [0, 0],
        [0.5, 0.6],
        [0.8, 0.9],
        [1, 1],
      ],
      nightH: [
        [0, 1],
        [48, 0.8],
        [100, 0.4],
        [200, 0],
      ],
    },
    sub: {
      safety: { radius: 0.5, roughness: 0.3, boulders: 0.2 },
      science: { psr: 0.6, ice: 0.4 },
      comms: { fraction: 0.6, gap: 0.4 },
      power: { sun: 0.6, night: 0.4 },
    },
    iceNeighbourhoodKm: 2,
  };
}

export interface ScoringPreset {
  id: string;
  label: string;
  description: string;
  weights: FactorWeights;
}

export const SCORING_PRESETS: readonly ScoringPreset[] = [
  {
    id: "balanced",
    label: "Balanced",
    description: "A safe touchdown first, then power, comms and science in similar measure.",
    weights: { safety: 0.35, science: 0.2, comms: 0.2, power: 0.25 },
  },
  {
    id: "safety",
    label: "Safety-first",
    description: "Flat, smooth ground matters most: a first landing or a heavy crewed lander.",
    weights: { safety: 0.55, science: 0.1, comms: 0.15, power: 0.2 },
  },
  {
    id: "science",
    label: "Science-first",
    description: "Get close to cold traps that may hold water ice.",
    weights: { safety: 0.25, science: 0.45, comms: 0.1, power: 0.2 },
  },
  {
    id: "comms",
    label: "Comms-first",
    description: "Keep the radio link: long contact windows, short blackouts.",
    weights: { safety: 0.25, science: 0.1, comms: 0.45, power: 0.2 },
  },
];

export const DEFAULT_PRESET_ID = "balanced";

export function presetWeights(id: string): FactorWeights {
  return { ...(SCORING_PRESETS.find((p) => p.id === id) ?? SCORING_PRESETS[0]!).weights };
}

/** Clamp negatives to 0 and scale to sum 1. All-zero → the fallback preset. */
export function normalizeWeights(
  w: FactorWeights,
  fallback: FactorWeights = SCORING_PRESETS[0]!.weights,
): FactorWeights {
  const c = Object.fromEntries(FACTORS.map((f) => [f, Math.max(0, w[f] || 0)])) as FactorWeights;
  const sum = FACTORS.reduce((s, f) => s + c[f], 0);
  if (sum <= 0) return { ...fallback };
  return Object.fromEntries(FACTORS.map((f) => [f, c[f] / sum])) as FactorWeights;
}

/**
 * Set one weight (0..1) and rescale the others proportionally so the total stays 1.
 * If the others are all 0, the remainder is shared equally.
 */
export function setWeight(w: FactorWeights, id: Factor, value: number): FactorWeights {
  const v = Math.min(1, Math.max(0, value));
  const others = FACTORS.filter((f) => f !== id);
  const rest = others.reduce((s, f) => s + Math.max(0, w[f]), 0);
  const out = { ...w, [id]: v } as FactorWeights;
  for (const f of others)
    out[f] = rest > 0 ? (Math.max(0, w[f]) / rest) * (1 - v) : (1 - v) / others.length;
  return out;
}
