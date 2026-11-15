"use client";

import { Badge, Panel } from "@/components/ui/Panel";
import type { Readiness } from "@/domain/scoring/explainCell";
import type { Site } from "@/domain/types";

export interface SiteScore {
  score: number | null;
  readiness: Readiness | null;
}

interface Props {
  sites: Site[];
  scores: Map<string, SiteScore>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const MARK: Record<Readiness, { icon: string; cls: string }> = {
  good: { icon: "✓", cls: "text-good" },
  possible: { icon: "~", cls: "text-warn" },
  poor: { icon: "✗", cls: "text-bad" },
  excluded: { icon: "⛔", cls: "text-bad" },
};

/** Named sites (auto-picked candidates, crater-floor references, your points), ranked by the cell model. */
export function SiteList({ sites, scores, selectedId, onSelect }: Props) {
  const ranked = [...sites].sort((a, b) => {
    const sa = scores.get(a.id)?.score ?? -1;
    const sb = scores.get(b.id)?.score ?? -1;
    return sb - sa;
  });
  return (
    <Panel title={`Named sites (${sites.length})`}>
      <ol className="-mx-2 space-y-0.5">
        {ranked.map((site) => {
          const s = scores.get(site.id);
          const m = s?.readiness ? MARK[s.readiness] : null;
          return (
            <li key={site.id}>
              <button
                type="button"
                onClick={() => onSelect(site.id)}
                aria-current={site.id === selectedId}
                className={`grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded px-2 py-1.5 text-left transition focus-visible:outline-2 focus-visible:outline-sun ${
                  site.id === selectedId ? "bg-panel-2 ring-1 ring-sun/60" : "hover:bg-panel-2"
                }`}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm">{site.name}</span>
                    <span className="font-mono text-[10px] text-muted">{site.id}</span>
                    {site.kind === "reference" && <Badge>crater floor</Badge>}
                    {site.kind === "custom" && <Badge tone="warn">your point</Badge>}
                  </span>
                </span>
                <span className={`font-mono text-sm ${m?.cls ?? "text-muted"}`}>
                  {m && <span aria-hidden="true">{m.icon} </span>}
                  {s?.readiness === "excluded"
                    ? "no-go"
                    : s?.score === null || s?.score === undefined
                      ? "–"
                      : Math.round(s.score)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
