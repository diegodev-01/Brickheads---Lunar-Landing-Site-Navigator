"use client";

import { Badge, Panel } from "@/components/ui/Panel";
import { scoreColor } from "@/components/ui/scoreColor";
import type { RankedSite } from "@/domain/scoring/score";
import type { Site, SiteConditions } from "@/domain/types";

interface Props {
  ranking: RankedSite[];
  sites: Site[];
  conditions: Map<string, SiteConditions>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SiteList({ ranking, sites, conditions, selectedId, onSelect }: Props) {
  const byId = new Map(sites.map((s) => [s.id, s]));
  return (
    <Panel title={`Ranked sites (${ranking.length})`}>
      <ol className="-mx-2 space-y-0.5">
        {ranking.map((r) => {
          const site = byId.get(r.siteId)!;
          const c = conditions.get(r.siteId);
          const nogo = r.flags.length > 0;
          return (
            <li key={r.siteId}>
              <button
                onClick={() => onSelect(r.siteId)}
                className={`grid w-full grid-cols-[22px_1fr_44px] items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                  r.siteId === selectedId ? "bg-panel-2 ring-1 ring-sun/60" : "hover:bg-panel-2"
                }`}
              >
                <span className="font-mono text-xs text-muted">{r.rank}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm">{site.name}</span>
                    <span className="font-mono text-[10px] text-muted">{site.id}</span>
                    {nogo && <Badge tone="bad">no-go</Badge>}
                    {site.kind === "custom" && <Badge tone="warn">no terrain</Badge>}
                    {site.kind === "reference" && <Badge>reference</Badge>}
                  </span>
                  <span className="mt-0.5 flex gap-3 font-mono text-[10px] text-muted">
                    <span className="text-sun">
                      ☀ {c ? Math.round(c.sun.fraction * 100) : "–"}%
                    </span>
                    <span className="text-earth">
                      ⊕ {c ? Math.round(c.earth.fraction * 100) : "–"}%
                    </span>
                    {site.slopeMeanDeg !== undefined && (
                      <span>∠ {site.slopeMeanDeg.toFixed(1)}°</span>
                    )}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span
                    className="font-mono text-sm"
                    style={{ color: nogo ? "#8b95a8" : scoreColor(r.score) }}
                  >
                    {Math.round(r.score)}
                  </span>
                  <span className="h-1 w-10 overflow-hidden rounded bg-line">
                    <span
                      className="block h-full"
                      style={{
                        width: `${r.score}%`,
                        background: nogo ? "#4a5263" : scoreColor(r.score),
                      }}
                    />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
