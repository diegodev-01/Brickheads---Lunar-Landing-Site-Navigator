/**
 * Two-stage cell evaluation (docs/scoring-model.md):
 *   Stage 1: hard gates → excluded cells get no score, every failure is recorded.
 *   Stage 2: weighted soft score from four normalised factors, with uncertainty.
 * Pure functions, no framework imports.
 */
import type { Confidence } from "../provenance";
import {
  FACTORS,
  normalizeWeights,
  type Factor,
  type FactorWeights,
  type ScoringModelConfig,
  type SlopeTheta,
} from "./model";
import { pl } from "./piecewise";

/** Everything the model needs about one cell. NaN = no data. */
export interface CellInputs {
  /** Largest flat circle (m) at each slope threshold. */
  safeRadiusM: Record<SlopeTheta, number>;
  slopeP95Deg: number;
  roughnessDeg: number;
  boulderIndex: number;
  sunFraction: number;
  longestNightH: number;
  dteFraction: number;
  dteGapH: number;
  /** Undefined until the relay module provides it. */
  relayFraction?: number;
  relayGapH?: number;
  psrDistanceKm: number;
  /** Max ice-probability index within the neighbourhood radius. */
  iceNearby: number;
}

/** Confidence of each input group (from data provenance). */
export interface InputConfidence {
  safeRadius: Confidence;
  roughness: Confidence;
  boulders: Confidence;
  illumination: Confidence;
  dte: Confidence;
  relay: Confidence;
  psr: Confidence;
  ice: Confidence;
}

export type GateId = "slope" | "roughness" | "boulders" | "comms" | "darkness";

export interface GateResult {
  id: GateId;
  passed: boolean;
  /** Measured value and threshold, in `unit`. */
  value: number;
  threshold: number;
  unit: string;
  /** True when the input is SIMULATED (e.g. boulders). */
  simulated: boolean;
  /** True when the gate failed because the input was missing. */
  noData: boolean;
}

export interface FactorResult {
  id: Factor;
  /** 0..1 */
  normalized: number;
  /** 1-σ uncertainty of `normalized`. */
  sigma: number;
  weight: number;
  /** 100·w·n: contribution to the score, in points. */
  points: number;
  /** Raw inputs used, for explanations. */
  raw: Record<string, number>;
}

export interface CellEvaluation {
  passed: boolean;
  /** 0..100, NaN when excluded. */
  score: number;
  /** 1-σ score uncertainty, points. NaN when excluded. */
  sigma: number;
  confidence: Confidence;
  gates: GateResult[];
  factors: FactorResult[];
}

export const CONFIDENCE_SIGMA: Record<Confidence, number> = { high: 0.05, medium: 0.12, low: 0.25 };

export function confidenceFromSigma(sigmaPoints: number): Confidence {
  return sigmaPoints < 5 ? "high" : sigmaPoints < 10 ? "medium" : "low";
}

const isNum = (v: number | undefined): v is number => v !== undefined && !Number.isNaN(v);

export function evaluateGates(
  c: CellInputs,
  cfg: ScoringModelConfig,
  conf: InputConfidence,
): GateResult[] {
  const g = cfg.gates;
  const out: GateResult[] = [];
  const gate = (
    id: GateId,
    value: number,
    threshold: number,
    unit: string,
    passes: (v: number) => boolean,
    simulated = false,
  ) => {
    const noData = Number.isNaN(value);
    out.push({ id, value, threshold, unit, simulated, noData, passed: !noData && passes(value) });
  };
  if (g.slope.enabled) {
    if (g.slope.mode === "lander") {
      gate(
        "slope",
        c.safeRadiusM[g.slope.thetaDeg],
        g.slope.radiusM,
        "m",
        (v) => v >= g.slope.radiusM,
      );
    } else {
      gate("slope", c.slopeP95Deg, g.slope.thetaDeg, "°", (v) => v <= g.slope.thetaDeg);
    }
  }
  if (g.roughness.enabled)
    gate("roughness", c.roughnessDeg, g.roughness.maxDeg, "°", (v) => v <= g.roughness.maxDeg);
  if (g.boulders.enabled) {
    gate(
      "boulders",
      c.boulderIndex,
      g.boulders.max,
      "",
      (v) => v <= g.boulders.max,
      conf.boulders === "low",
    );
  }
  if (g.comms.enabled) {
    // Best available link: DTE, or relay once the relay module provides it.
    const best = Math.max(
      isNum(c.dteFraction) ? c.dteFraction : Number.NEGATIVE_INFINITY,
      isNum(c.relayFraction) ? c.relayFraction : Number.NEGATIVE_INFINITY,
    );
    gate("comms", Number.isFinite(best) ? best : Number.NaN, 0, "fraction", (v) => v > 0);
  }
  if (g.darkness.enabled) gate("darkness", c.sunFraction, 0, "fraction", (v) => v > 0);
  return out;
}

/** Weighted average of sub-terms, renormalised over the terms that have data. */
function blend(terms: [w: number, value: number, sigma: number][]): { n: number; sigma: number } {
  let w = 0;
  let s = 0;
  let sg = 0;
  for (const [wi, v, si] of terms) {
    if (Number.isNaN(v) || wi <= 0) continue;
    w += wi;
    s += wi * v;
    sg += wi * si;
  }
  // A factor with no data at all scores 0 with maximum uncertainty (never silently "perfect").
  return w === 0 ? { n: 0, sigma: CONFIDENCE_SIGMA.low } : { n: s / w, sigma: sg / w };
}

export function evaluateFactors(
  c: CellInputs,
  cfg: ScoringModelConfig,
  conf: InputConfidence,
  weights: FactorWeights,
): FactorResult[] {
  const cv = cfg.curves;
  const sub = cfg.sub;
  const R = cfg.gates.slope.radiusM;
  const radius = c.safeRadiusM[cfg.gates.slope.thetaDeg];
  const S = CONFIDENCE_SIGMA;
  const w = normalizeWeights(weights);

  const hasRelay = isNum(c.relayFraction);
  const useRelay = hasRelay && c.relayFraction! > (isNum(c.dteFraction) ? c.dteFraction : -1);
  const commsFraction = useRelay ? c.relayFraction! : c.dteFraction;
  const commsGap =
    hasRelay && isNum(c.relayGapH)
      ? Math.min(c.relayGapH, isNum(c.dteGapH) ? c.dteGapH : Number.POSITIVE_INFINITY)
      : c.dteGapH;
  const commsSigma = useRelay ? S[conf.relay] : S[conf.dte];

  const parts: Record<Factor, { n: number; sigma: number; raw: Record<string, number> }> = {
    safety: {
      ...blend([
        [
          sub.safety.radius,
          pl(R > 0 ? radius / R : Number.NaN, cv.safetyRadius),
          S[conf.safeRadius],
        ],
        [sub.safety.roughness, pl(c.roughnessDeg, cv.roughness), S[conf.roughness]],
        [sub.safety.boulders, pl(c.boulderIndex, cv.boulders), S[conf.boulders]],
      ]),
      raw: {
        safeRadiusM: radius,
        roughnessDeg: c.roughnessDeg,
        boulderIndex: c.boulderIndex,
        slopeP95Deg: c.slopeP95Deg,
      },
    },
    science: {
      ...blend([
        [sub.science.psr, pl(c.psrDistanceKm, cv.psrDistanceKm), S[conf.psr]],
        [sub.science.ice, pl(c.iceNearby, cv.iceNearby), S[conf.ice]],
      ]),
      raw: { psrDistanceKm: c.psrDistanceKm, iceNearby: c.iceNearby },
    },
    comms: {
      ...blend([
        [sub.comms.fraction, pl(commsFraction, cv.commsFraction), commsSigma],
        [sub.comms.gap, pl(commsGap, cv.commsGapH), commsSigma],
      ]),
      raw: { fraction: commsFraction, gapH: commsGap, viaRelay: useRelay ? 1 : 0 },
    },
    power: {
      ...blend([
        [sub.power.sun, pl(c.sunFraction, cv.sunFraction), S[conf.illumination]],
        [sub.power.night, pl(c.longestNightH, cv.nightH), S[conf.illumination]],
      ]),
      raw: { sunFraction: c.sunFraction, longestNightH: c.longestNightH },
    },
  };

  return FACTORS.map((id) => ({
    id,
    normalized: parts[id].n,
    sigma: parts[id].sigma,
    weight: w[id],
    points: 100 * w[id] * parts[id].n,
    raw: parts[id].raw,
  }));
}

export function evaluateCell(
  c: CellInputs,
  cfg: ScoringModelConfig,
  conf: InputConfidence,
  weights: FactorWeights,
): CellEvaluation {
  const gates = evaluateGates(c, cfg, conf);
  const factors = evaluateFactors(c, cfg, conf, weights);
  const passed = gates.every((g) => g.passed);
  if (!passed) {
    return { passed, score: Number.NaN, sigma: Number.NaN, confidence: "low", gates, factors };
  }
  const score = factors.reduce((s, f) => s + f.points, 0);
  const sigma = 100 * Math.sqrt(factors.reduce((s, f) => s + (f.weight * f.sigma) ** 2, 0));
  return { passed, score, sigma, confidence: confidenceFromSigma(sigma), gates, factors };
}
