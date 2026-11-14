/**
 * Plain-language explanations from structured evaluations, using fixed templates
 * (docs/scoring-model.md §6–7). No free text generation: every sentence is traceable to numbers.
 */
import type { Confidence } from "../provenance";
import type { CellEvaluation, FactorResult, GateResult } from "./evaluate";
import { FACTOR_LABEL, type Factor } from "./model";

export type Readiness = "good" | "possible" | "poor" | "excluded";

export const READINESS_HEADLINE: Record<Readiness, string> = {
  good: "Good landing candidate",
  possible: "Possible landing site, with trade-offs",
  poor: "Poor landing candidate",
  excluded: "Not safe to land here",
};

export function readinessOf(e: CellEvaluation): Readiness {
  if (!e.passed) return "excluded";
  return e.score >= 75 ? "good" : e.score >= 55 ? "possible" : "poor";
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
export const fmtHours = (h: number) =>
  !Number.isFinite(h) ? "–" : h >= 48 ? `${(h / 24).toFixed(1)} days` : `${Math.round(h)} h`;
const km = (k: number) => (k < 1 ? `${Math.round(k * 1000)} m` : `${k.toFixed(1)} km`);

type Level = "high" | "mid" | "low";
const level = (n: number): Level => (n >= 0.75 ? "high" : n >= 0.4 ? "mid" : "low");

/** Short phrase describing one factor, chosen by its normalised level, with its numbers. */
export function factorPhrase(f: FactorResult): string {
  const r = f.raw;
  const l = level(f.normalized);
  switch (f.id) {
    case "safety": {
      const width = Number.isNaN(r.safeRadiusM!) ? "–" : `${Math.round(2 * r.safeRadiusM!)} m-wide`;
      return l === "high"
        ? `a ${width} flat area`
        : l === "mid"
          ? `a small but usable flat spot (${width})`
          : `only a marginal flat spot (${width})`;
    }
    case "power":
      return l === "high"
        ? `sunlit ${pct(r.sunFraction!)} of the window`
        : l === "mid"
          ? `sunlit about ${pct(r.sunFraction!)} of the time (longest night ${fmtHours(r.longestNightH!)})`
          : `long nights (up to ${fmtHours(r.longestNightH!)})`;
    case "comms": {
      const via = r.viaRelay ? "the relay" : "Earth";
      return l === "high"
        ? `${via} in view ${pct(r.fraction!)} of the time`
        : l === "mid"
          ? `intermittent contact with ${via} (${pct(r.fraction!)})`
          : `long comms blackouts (up to ${fmtHours(r.gapH!)})`;
    }
    case "science":
      return l === "high"
        ? `a cold trap ${km(r.psrDistanceKm!)} away`
        : l === "mid"
          ? `a cold trap within ${km(r.psrDistanceKm!)}`
          : `no cold trap nearby (${km(r.psrDistanceKm!)})`;
  }
}

/** Why a gate failed, in plain words with the numbers. */
export function gatePhrase(g: GateResult): string {
  if (g.noData) return `no ${g.id} data for this spot`;
  switch (g.id) {
    case "slope":
      return g.unit === "m"
        ? `no flat spot ≥ ${g.threshold} m radius (largest is ${Math.round(g.value)} m)`
        : `too steep (${g.value.toFixed(1)}° vs ${g.threshold}° limit)`;
    case "roughness":
      return `ground too rough (${g.value.toFixed(1)}° vs ${g.threshold}° limit)`;
    case "boulders":
      return `likely boulder field (simulated index ${g.value.toFixed(2)} > ${g.threshold})`;
    case "comms":
      return "no radio contact with Earth or the relay during the window";
    case "darkness":
      return "the Sun never rises above the terrain during the window";
  }
}

export interface CellExplanation {
  readiness: Readiness;
  headline: string;
  confidence: Confidence;
  /** e.g. "82 ± 6" or "excluded". */
  scoreText: string;
  sentence: string;
  /** 3–4 plain-language bullets. */
  reasons: { icon: string; text: string; tone: "good" | "warn" | "bad" | "info" }[];
  /** Factor contributions sorted by points (largest first). */
  contributions: {
    id: Factor;
    label: string;
    points: number;
    normalized: number;
    weight: number;
  }[];
}

const ICON: Record<Factor, string> = { safety: "⛰", power: "☀", comms: "📡", science: "🧊" };

export function explainCell(
  e: CellEvaluation,
  name = "This spot",
  opts: { simulatedInputs?: string[] } = {},
): CellExplanation {
  const readiness = readinessOf(e);
  const sorted = [...e.factors].filter((f) => f.weight > 0).sort((a, b) => b.points - a.points);
  const contributions = sorted.map((f) => ({
    id: f.id,
    label: FACTOR_LABEL[f.id],
    points: f.points,
    normalized: f.normalized,
    weight: f.weight,
  }));
  const reasons: CellExplanation["reasons"] = [];

  if (readiness === "excluded") {
    const failed = e.gates.filter((g) => !g.passed);
    for (const g of failed) {
      reasons.push({ icon: "⛔", text: capitalise(gatePhrase(g)), tone: "bad" });
    }
    const best = sorted[0];
    if (best && reasons.length < 4) {
      reasons.push({ icon: ICON[best.id], text: `Otherwise: ${factorPhrase(best)}`, tone: "info" });
    }
    return {
      readiness,
      headline: READINESS_HEADLINE.excluded,
      confidence: e.confidence,
      scoreText: "excluded",
      sentence: `${name} is excluded: ${failed.map(gatePhrase).join("; ")}.`,
      reasons: reasons.slice(0, 4),
      contributions,
    };
  }

  // Largest weighted shortfall = the main drawback.
  const worst = [...sorted].sort(
    (a, b) => b.weight * (1 - b.normalized) - a.weight * (1 - a.normalized),
  )[0]!;
  const top = sorted.filter((f) => f !== worst).slice(0, 2);
  const scoreText = `${Math.round(e.score)} ± ${Math.max(1, Math.round(e.sigma))}`;
  const strengths = top.map(factorPhrase);
  const sentence = `${name} scores ${scoreText}: ${strengths.join(" and ")}; the main drawback is ${factorPhrase(worst)}.`;

  for (const f of top) {
    reasons.push({
      icon: ICON[f.id],
      text: capitalise(factorPhrase(f)),
      tone: f.normalized >= 0.75 ? "good" : "info",
    });
  }
  reasons.push({
    icon: "⚠",
    text: capitalise(factorPhrase(worst)),
    tone: worst.normalized < 0.4 ? "bad" : "warn",
  });
  if (opts.simulatedInputs?.length) {
    reasons.push({
      icon: "◇",
      text: `${opts.simulatedInputs.join(", ")} ${opts.simulatedInputs.length > 1 ? "are" : "is"} simulated (no real data at this resolution)`,
      tone: "info",
    });
  }
  return {
    readiness,
    headline: READINESS_HEADLINE[readiness],
    confidence: e.confidence,
    scoreText,
    sentence,
    reasons: reasons.slice(0, 4),
    contributions,
  };
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
