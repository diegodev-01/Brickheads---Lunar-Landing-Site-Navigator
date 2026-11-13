/**
 * Weighted, explainable suitability score.
 *
 *   score = 100 * Σ wᵢ·nᵢ / Σ wᵢ      (over factors with data and wᵢ > 0)
 *
 * Hard limits never change the score; they raise "no-go" flags and push the site below all
 * feasible sites in the ranking, so safety and preference stay visibly separate.
 */
import type { Site, SiteConditions } from "../types";
import {
  DEFAULT_CONFIG,
  FACTOR_IDS,
  type FactorId,
  type ScoringConfig,
  type Weights,
} from "./config";
import { FACTORS, normalize, type FactorInput } from "./factors";

export interface FactorResult {
  id: FactorId;
  label: string;
  unit: string;
  why: string;
  raw: number | null;
  /** 0..1, null when no data. */
  normalized: number | null;
  weight: number;
  /** Points (0..100) this factor adds to the final score. */
  points: number;
  /** Points lost versus a perfect value on this factor. */
  pointsLost: number;
  text: string | null;
}

export interface NoGoFlag {
  code: "slope" | "psr";
  message: string;
}

export interface ScoreBreakdown {
  siteId: string;
  score: number;
  factors: FactorResult[];
  flags: NoGoFlag[];
  /** Factors skipped because the site lacks that data (e.g. custom coordinates). */
  missing: FactorId[];
}

export interface RankedSite extends ScoreBreakdown {
  rank: number;
}

export function scoreSite(
  input: FactorInput,
  weights: Weights,
  config: ScoringConfig = DEFAULT_CONFIG,
): ScoreBreakdown {
  const partial = FACTOR_IDS.map((id) => {
    const def = FACTORS[id];
    const raw = def.raw(input);
    const normalized = raw === null ? null : normalize(raw, config.ramps[id]);
    return { def, raw, normalized, weight: Math.max(0, weights[id] ?? 0) };
  });

  const active = partial.filter((p) => p.normalized !== null && p.weight > 0);
  const totalWeight = active.reduce((s, p) => s + p.weight, 0);

  const factors: FactorResult[] = partial.map(({ def, raw, normalized, weight }) => {
    const share = normalized !== null && totalWeight > 0 ? weight / totalWeight : 0;
    return {
      id: def.id,
      label: def.label,
      unit: def.unit,
      why: def.why,
      raw,
      normalized,
      weight,
      points: 100 * share * (normalized ?? 0),
      pointsLost: 100 * share * (1 - (normalized ?? 0)),
      text: raw === null ? null : def.describe(raw, input),
    };
  });

  const flags: NoGoFlag[] = [];
  const { site } = input;
  if (site.slopeMeanDeg !== undefined && site.slopeMeanDeg > config.limits.maxSlopeDeg) {
    flags.push({
      code: "slope",
      message: `Mean slope ${site.slopeMeanDeg.toFixed(1)}° exceeds the ${config.limits.maxSlopeDeg}° landing limit.`,
    });
  }
  if (config.limits.rejectInPsr && site.inPsr) {
    flags.push({ code: "psr", message: "Inside permanent shadow: no solar power is possible." });
  }

  return {
    siteId: site.id,
    score: factors.reduce((s, f) => s + f.points, 0),
    factors,
    flags,
    missing: partial.filter((p) => p.raw === null).map((p) => p.def.id),
  };
}

/** Scores and ranks sites: feasible sites first (by score), then no-go sites (by score). */
export function rankSites(
  sites: Site[],
  conditions: Map<string, SiteConditions>,
  weights: Weights,
  windowDays: number,
  config: ScoringConfig = DEFAULT_CONFIG,
): RankedSite[] {
  return sites
    .map((site) =>
      scoreSite({ site, conditions: conditions.get(site.id), windowDays }, weights, config),
    )
    .sort((a, b) => {
      const ga = a.flags.length > 0 ? 1 : 0;
      const gb = b.flags.length > 0 ? 1 : 0;
      return ga - gb || b.score - a.score || a.siteId.localeCompare(b.siteId);
    })
    .map((s, i) => ({ ...s, rank: i + 1 }));
}
