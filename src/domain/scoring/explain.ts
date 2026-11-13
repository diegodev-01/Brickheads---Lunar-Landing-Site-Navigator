import { FACTORS } from "./factors";
import type { RankedSite } from "./score";

export interface Explanation {
  headline: string;
  strengths: string[];
  weaknesses: string[];
  caveats: string[];
}

const STRONG = 0.7;
const WEAK = 0.4;

/** Plain-language reasons for a site's rank, ordered by how many points each factor moved. */
export function explain(site: RankedSite, total: number): Explanation {
  const scored = site.factors.filter((f) => f.normalized !== null && f.weight > 0 && f.text);

  const strengths = scored
    .filter((f) => f.normalized! >= STRONG)
    .sort((a, b) => b.points - a.points)
    .map((f) => `${capitalize(f.text!)} (+${Math.round(f.points)} pts).`);

  const weaknesses = scored
    .filter((f) => f.normalized! <= WEAK)
    .sort((a, b) => b.pointsLost - a.pointsLost)
    .map((f) => `${capitalize(f.text!)} (−${Math.round(f.pointsLost)} pts possible).`);

  const caveats = [
    ...site.flags.map((f) => `No-go: ${f.message}`),
    ...(site.missing.length
      ? [
          `Not scored (no data here): ${site.missing.map((id) => FACTORS[id].label.toLowerCase()).join(", ")}.`,
        ]
      : []),
  ];

  const top = scored.slice().sort((a, b) => b.points - a.points)[0];
  const worst = scored.slice().sort((a, b) => b.pointsLost - a.pointsLost)[0];
  let headline = `Scores ${Math.round(site.score)}/100, rank #${site.rank} of ${total}.`;
  if (site.flags.length) headline += " Ranked below feasible sites because of a hard limit.";
  else if (top && worst && worst.pointsLost >= 10 && worst.id !== top.id)
    headline += ` Strongest on ${top.label.toLowerCase()}; held back by ${worst.label.toLowerCase()}.`;
  else if (top) headline += ` Driven mainly by ${top.label.toLowerCase()}.`;

  return { headline, strengths, weaknesses, caveats };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
