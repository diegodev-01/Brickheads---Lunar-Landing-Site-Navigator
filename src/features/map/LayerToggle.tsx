"use client";

import { ProvenanceBadge } from "@/components/ui/Panel";
import { SUITABILITY } from "./heatmap";
import type { LayerEntry } from "./layerCatalog";

/**
 * Layer switcher (collapsed by default, so the map stays visible) plus an always-visible legend
 * that says in words what the colours mean, with the layer's provenance.
 */
export function LayerToggle({
  layers,
  activeId,
  onChange,
  busy = false,
}: {
  layers: LayerEntry[];
  activeId: string;
  onChange: (id: string) => void;
  /** Shown while a computed layer is being recalculated. */
  busy?: boolean;
}) {
  const active = layers.find((l) => l.id === activeId);
  const groups: { title: string; items: LayerEntry[] }[] = [
    { title: "For your dates", items: layers.filter((l) => l.kind === "grid") },
    {
      title: "Instruments (real data where verified)",
      items: layers.filter((l) => l.kind === "sensor"),
    },
    { title: "Reference maps", items: layers.filter((l) => l.kind === "static") },
  ];
  return (
    <div className="flex max-h-full w-56 flex-col gap-1.5 text-xs sm:w-64">
      <details className="min-h-0 overflow-y-auto rounded-md border border-line bg-panel/95 shadow-lg backdrop-blur">
        <summary className="cursor-pointer px-2 py-1.5 font-medium focus-visible:outline-2 focus-visible:outline-sun">
          <span className="text-[10px] tracking-[0.12em] text-muted uppercase">Layer: </span>
          {active?.label ?? "Terrain only"}
        </summary>
        <fieldset className="space-y-1.5 px-2 pb-2">
          <legend className="sr-only">Map layer</legend>
          <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-panel-2">
            <input
              type="radio"
              name="layer"
              checked={activeId === "none"}
              onChange={() => onChange("none")}
              className="accent-sun"
            />
            Terrain only
          </label>
          {groups.map((g) => (
            <div key={g.title}>
              <div className="px-1 text-[10px] tracking-wider text-muted uppercase">{g.title}</div>
              {g.items.map((l) => (
                <label
                  key={l.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-panel-2"
                >
                  <input
                    type="radio"
                    name="layer"
                    checked={activeId === l.id}
                    onChange={() => onChange(l.id)}
                    className="accent-sun"
                    aria-describedby={`help-${l.id}`}
                  />
                  <span className="flex-1">{l.label}</span>
                  <span id={`help-${l.id}`} className="sr-only">
                    {l.help}
                  </span>
                  {l.kind === "sensor" && (
                    <span className="text-[9px] text-muted" title={l.provenance}>
                      <span aria-hidden="true">
                        {l.provenance === "measured" ? "●" : l.provenance === "derived" ? "◐" : "◇"}
                      </span>
                      <span className="sr-only">{l.provenance} data</span>
                    </span>
                  )}
                </label>
              ))}
            </div>
          ))}
        </fieldset>
      </details>

      {active && (
        <div className="rounded-md border border-line bg-panel/95 p-2 shadow-lg backdrop-blur">
          <p className="text-[11px] leading-snug">{active.help}</p>
          {active.id === "suitability" ? (
            <ul className="mt-1.5 grid grid-cols-2 gap-1 text-[10px]">
              {Object.entries(SUITABILITY).map(([k, v]) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block h-3 w-4 rounded-sm border border-black/40"
                    style={{
                      background:
                        k === "excluded"
                          ? `repeating-linear-gradient(45deg, rgb(${v.color.join(",")}) 0 2px, transparent 2px 5px)`
                          : k === "poor"
                            ? `radial-gradient(circle, #280a0a 1px, transparent 1.5px) 0 0/4px 4px, rgb(${v.color.join(",")})`
                            : `rgb(${v.color.join(",")})`,
                    }}
                  />
                  {v.label}
                </li>
              ))}
            </ul>
          ) : (
            active.legend && (
              <div className="mt-1.5">
                <div
                  className="h-2.5 rounded"
                  style={{
                    background: `linear-gradient(to right, ${active.legend.stops.join(", ")})`,
                  }}
                  role="img"
                  aria-label={`Colour scale from ${active.legend.lowMeaning} to ${active.legend.highMeaning}`}
                />
                <div className="mt-0.5 flex justify-between font-mono text-[10px] text-muted">
                  <span>{active.legend.minLabel}</span>
                  <span>{active.legend.maxLabel}</span>
                </div>
                <div className="mt-0.5 flex justify-between gap-2 text-[10px] leading-tight">
                  <span>{active.legend.lowMeaning}</span>
                  <span className="text-right">{active.legend.highMeaning}</span>
                </div>
              </div>
            )
          )}
          <div className="mt-1.5 flex items-start gap-1">
            <ProvenanceBadge value={active.provenance} title={active.source} />
            <span
              className="line-clamp-2 text-[10px] leading-tight text-muted max-sm:hidden"
              title={active.source}
            >
              {active.source}
            </span>
          </div>
          {busy && (
            <p className="mt-1 text-[10px] text-sun" role="status">
              Recomputing for your dates…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
