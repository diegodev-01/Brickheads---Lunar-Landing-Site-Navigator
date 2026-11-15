"use client";

import { Panel } from "@/components/ui/Panel";
import type { Zone } from "@/domain/scoring/grid";
import type { Recommendation } from "./useRecommendation";
import { ReadinessCard } from "./ReadinessCard";

export const ZONE_LETTERS = ["A", "B", "C", "D", "E"];

interface Props {
  rec: Recommendation;
  cellSizeM: number;
  onInspect: (zone: Zone) => void;
  hasRoi: boolean;
}

/** The top-3 recommended zones, each with its readiness summary and explanation. */
export function ZoneCards({ rec, cellSizeM, onInspect, hasRoi }: Props) {
  if (!rec.ready) {
    return (
      <Panel title="Recommended landing zones">
        <p className="text-sm text-muted" role="status">
          Computing sunlight and Earth contact for your dates…
        </p>
      </Panel>
    );
  }
  const area = (z: Zone) => ((z.cells.length * cellSizeM * cellSizeM) / 1e6).toFixed(2);
  return (
    <div>
      <Panel
        title={`Top ${rec.zones.length} landing zones ${hasRoi ? "in your search area" : "in the region"}`}
        right={
          rec.provisional ? (
            <span className="text-[10px] text-sun" role="status">
              refining…
            </span>
          ) : null
        }
      >
        {rec.zones.length === 0 ? (
          <p className="text-sm">
            No cell here passes every hard limit. Try a larger search area, a later date, or relax
            the slope limit under <em>Hard limits</em>.
          </p>
        ) : (
          <p className="text-[11px] text-muted">
            Best cells at least 3 km apart. Each zone is the connected good ground around the pick.
            {rec.zones.length < 3 &&
              ` Only ${rec.zones.length} separate safe zone${rec.zones.length > 1 ? "s" : ""} here: try a larger search area.`}
          </p>
        )}
      </Panel>
      {rec.zones.map((z, i) => {
        const x = rec.explain(z.cell, `Zone ${ZONE_LETTERS[i]}`);
        if (!x) return null;
        return (
          <div key={z.cell}>
            <ReadinessCard
              evaluation={x.evaluation}
              explanation={x.explanation}
              title={`Zone ${ZONE_LETTERS[i]} · ${area(z)} km² of good ground`}
            />
            <div className="-mt-1 mb-2 px-4">
              <button
                type="button"
                onClick={() => onInspect(z)}
                className="rounded border border-sun/60 px-2 py-0.5 text-xs text-sun hover:bg-sun/10 focus-visible:outline-2 focus-visible:outline-sun"
              >
                Inspect zone {ZONE_LETTERS[i]} →
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
