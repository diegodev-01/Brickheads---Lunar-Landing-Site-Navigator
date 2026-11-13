import { clamp } from "../geo/angles";
import type { Site, SiteConditions } from "../types";
import type { FactorId, Ramp } from "./config";

export interface FactorInput {
  site: Site;
  conditions?: SiteConditions;
  windowDays: number;
}

export interface FactorDefinition {
  id: FactorId;
  label: string;
  unit: string;
  /** Why this matters, in plain language (shown as a tooltip / legend). */
  why: string;
  /** Raw measured value, or null when the data is not available for this site. */
  raw(input: FactorInput): number | null;
  /** Human sentence fragment describing the raw value. */
  describe(raw: number, input: FactorInput): string;
}

/** Linear 0..1 score: 1 at `best`, 0 at `worst`, clamped. */
export function normalize(raw: number, { best, worst }: Ramp): number {
  if (best === worst) return raw === best ? 1 : 0;
  return clamp((raw - worst) / (best - worst), 0, 1);
}

const fmtDays = (d: number) => `${Math.round(d * 10) / 10}-day`;

export const FACTORS: Record<FactorId, FactorDefinition> = {
  sunlight: {
    id: "sunlight",
    label: "Sunlight",
    unit: "%",
    why: "Solar power and thermal survival: share of time the Sun clears the local terrain.",
    raw: ({ conditions }) => (conditions ? conditions.sun.fraction * 100 : null),
    describe: (raw, { windowDays }) =>
      `sunlit ${Math.round(raw)}% of the ${fmtDays(windowDays)} window`,
  },
  earth: {
    id: "earth",
    label: "Earth in view",
    unit: "%",
    why: "Direct-to-Earth radio needs Earth above the local horizon (no relay satellite).",
    raw: ({ conditions }) => (conditions ? conditions.earth.fraction * 100 : null),
    describe: (raw) => `Earth above the horizon ${Math.round(raw)}% of the time`,
  },
  slope: {
    id: "slope",
    label: "Slope",
    unit: "°",
    why: "Landers tip over or slide on steep ground; flatter is safer.",
    raw: ({ site }) => site.slopeMeanDeg ?? null,
    describe: (raw) => `mean slope ${raw.toFixed(1)}°`,
  },
  roughness: {
    id: "roughness",
    label: "Roughness",
    unit: "°",
    why: "Variable slopes signal rocks, small craters and uneven footing (proxy from 20 m LOLA).",
    raw: ({ site }) => site.roughnessDeg ?? null,
    describe: (raw) => `slope variability ${raw.toFixed(1)}°`,
  },
  iceAccess: {
    id: "iceAccess",
    label: "Ice access",
    unit: "km",
    why: "Permanently shadowed craters may trap water ice: closer means easier science access.",
    raw: ({ site }) => site.psrDistanceKm ?? null,
    describe: (raw) =>
      raw < 0.05
        ? "inside a permanently shadowed region"
        : `${raw.toFixed(1)} km from permanent shadow`,
  },
};
