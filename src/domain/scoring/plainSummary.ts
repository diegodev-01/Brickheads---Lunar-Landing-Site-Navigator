/**
 * The same evaluation as explainCell, reworded for someone with no technical background:
 * one verdict, one piece of advice, and four everyday questions each answered with a 1–5 rating
 * and a single sentence. Fixed templates only, so every sentence traces back to the numbers.
 */
import type { SiteConditions } from "../types";
import type { CellEvaluation, FactorResult, GateResult } from "./evaluate";
import { fmtHours, readinessOf, type Readiness } from "./explainCell";
import type { Factor } from "./model";

export type PlainRating = "great" | "ok" | "weak" | "blocked" | "unknown";

export interface PlainRow {
  id: Factor;
  /** Everyday name of the factor. */
  title: string;
  rating: PlainRating;
  ratingWord: string;
  /** 0 (blocked or unknown) to 5. */
  stars: number;
  text: string;
}

export interface PlainSummary {
  /** "unknown" = outside the area with detailed terrain data: only Sun and Earth can be judged. */
  readiness: Readiness | "unknown";
  verdict: string;
  advice: string;
  /** 0–100, or null when the spot fails a must-have check. */
  score: number | null;
  rows: PlainRow[];
}

const VERDICT: Record<Readiness, { verdict: string; advice: string }> = {
  good: {
    verdict: "Good place to land",
    advice: "This spot does well on the things that matter for your mission.",
  },
  possible: {
    verdict: "Possible, with trade-offs",
    advice: "You could land here, but look at the weaker points below first.",
  },
  poor: {
    verdict: "Not a good choice",
    advice: "Landing is possible, but there are clearly better spots nearby.",
  },
  excluded: {
    verdict: "Do not land here",
    advice: "This spot fails a must-have check, so it is ruled out.",
  },
};

export const PLAIN_TITLE: Record<Factor, string> = {
  safety: "Safe ground",
  power: "Sunlight for power",
  comms: "Contact with Earth",
  science: "Water ice nearby",
};

const RATING_WORD: Record<PlainRating, string> = {
  great: "Great",
  ok: "OK",
  weak: "Weak",
  blocked: "Problem",
  unknown: "No data",
};

const GATE_FACTOR: Record<GateResult["id"], Factor> = {
  slope: "safety",
  roughness: "safety",
  boulders: "safety",
  comms: "comms",
  darkness: "power",
};

const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)} %` : "an unknown share");
const dist = (k: number) =>
  !Number.isFinite(k)
    ? "an unknown distance"
    : k < 1
      ? `${Math.round(k * 1000)} m`
      : `${k.toFixed(1)} km`;

function blockedText(g: GateResult): string {
  if (g.noData) return "We have no reliable data for this spot.";
  switch (g.id) {
    case "slope":
      return "Too steep: there is no flat patch big enough for a lander.";
    case "roughness":
      return "The ground is too bumpy to touch down safely.";
    case "boulders":
      return "Large rocks are likely here (this is an estimate, not a measurement).";
    case "comms":
      return "No radio contact with Earth at any moment of your stay.";
    case "darkness":
      return "The Sun never rises here during your stay.";
  }
}

function rowText(f: FactorResult, rating: PlainRating): string {
  const r = f.raw;
  switch (f.id) {
    case "safety": {
      const w = Number.isFinite(r.safeRadiusM!)
        ? `about ${Math.round(2 * r.safeRadiusM!)} m wide`
        : null;
      if (!w) return "We could not measure the flat ground here.";
      return rating === "great"
        ? `Flat, smooth ground ${w}: plenty of room to touch down.`
        : rating === "ok"
          ? `There is a flat patch ${w}, with little room for error.`
          : `Only a small flat patch (${w}). Risky.`;
    }
    case "power":
      if (r.sunFraction === 0)
        return "The Sun never rises here during your stay, so solar panels would get no power.";
      return `In sunlight ${pct(r.sunFraction!)} of your stay. Longest stretch of darkness: ${fmtHours(r.longestNightH!)}.`;
    case "comms":
      return `Can talk to Earth ${r.viaRelay ? "through a relay satellite" : "directly"} ${pct(r.fraction!)} of the time. Longest silence: ${fmtHours(r.gapH!)}.`;
    case "science":
      return rating === "great"
        ? `A permanently dark crater that may hold water ice is only ${dist(r.psrDistanceKm!)} away.`
        : rating === "ok"
          ? `A dark crater that may hold water ice is ${dist(r.psrDistanceKm!)} away.`
          : `The nearest place that may hold water ice is ${dist(r.psrDistanceKm!)} away.`;
  }
}

const ORDER: Factor[] = ["safety", "power", "comms", "science"];

export function plainSummary(e: CellEvaluation): PlainSummary {
  const readiness = readinessOf(e);
  const failed = e.gates.filter((g) => !g.passed);
  const rows = ORDER.flatMap((id) => {
    const f = e.factors.find((x) => x.id === id);
    if (!f) return [];
    const block = failed.find((g) => GATE_FACTOR[g.id] === id);
    const rating: PlainRating = block
      ? "blocked"
      : f.normalized >= 0.75
        ? "great"
        : f.normalized >= 0.4
          ? "ok"
          : "weak";
    return [
      {
        id,
        title: PLAIN_TITLE[id],
        rating,
        ratingWord: RATING_WORD[rating],
        stars: block ? 0 : Math.max(1, Math.min(5, Math.round(f.normalized * 5))),
        text: block ? blockedText(block) : rowText(f, rating),
      },
    ];
  });
  return {
    readiness,
    ...VERDICT[readiness],
    score: e.passed ? Math.round(e.score) : null,
    rows,
  };
}

const levelOf = (n: number): PlainRating => (n >= 0.75 ? "great" : n >= 0.4 ? "ok" : "weak");
const starsOf = (n: number) => Math.max(1, Math.min(5, Math.round(n * 5)));

/**
 * Summary for a point OUTSIDE the detailed terrain grid. Only what the Sun/Earth ephemeris can
 * tell on a smooth Moon is rated; ground safety and ice are reported as unknown, never guessed.
 */
export function plainGlobalSummary(c: SiteConditions, detailedAreaName: string): PlainSummary {
  const sun = c.sun.fraction;
  const earth = c.earth.fraction;
  const noData = (id: Factor, text: string): PlainRow => ({
    id,
    title: PLAIN_TITLE[id],
    rating: "unknown",
    ratingWord: RATING_WORD.unknown,
    stars: 0,
    text,
  });
  const rated = (id: Factor, n: number, text: string): PlainRow => {
    const rating = levelOf(n);
    return {
      id,
      title: PLAIN_TITLE[id],
      rating,
      ratingWord: RATING_WORD[rating],
      stars: starsOf(n),
      text,
    };
  };
  return {
    readiness: "unknown",
    verdict: "Not enough data to judge this spot",
    advice: `Here we can only tell you about sunlight and contact with Earth. Detailed ground data covers the ${detailedAreaName} only.`,
    score: null,
    rows: [
      noData(
        "safety",
        "No detailed terrain map here yet, so we cannot say if the ground is flat enough.",
      ),
      rated(
        "power",
        sun,
        `In sunlight ${pct(sun)} of your stay (ignoring hills). Longest stretch of darkness: ${fmtHours(c.sun.longestGapHours)}.`,
      ),
      earth > 0
        ? rated(
            "comms",
            earth,
            `Earth is in the sky ${pct(earth)} of the time, so a direct radio link is possible. Longest silence: ${fmtHours(c.earth.longestGapHours)}.`,
          )
        : {
            ...rated(
              "comms",
              0,
              "Earth is never in the sky here (far side of the Moon). A relay satellite would be needed.",
            ),
          },
      noData("science", "No ice data here yet."),
    ],
  };
}
