"use client";

import { ProvenanceBadge } from "@/components/ui/Panel";
import type { LayerEntry } from "./layerCatalog";

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
    { title: "Reference maps", items: layers.filter((l) => l.kind === "static") },
  ];
  return (
    <details
      open
      className="w-52 rounded-md border border-line bg-panel/95 p-2 text-xs shadow-lg backdrop-blur sm:w-64"
    >
      <summary className="mb-1.5 cursor-pointer text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
        Map layer
      </summary>
      <fieldset className="space-y-1.5">
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
                title={l.help}
              >
                <input
                  type="radio"
                  name="layer"
                  checked={activeId === l.id}
                  onChange={() => onChange(l.id)}
                  className="accent-sun"
                />
                {l.label}
              </label>
            ))}
          </div>
        ))}
      </fieldset>
      {active && (
        <div className="mt-2 border-t border-line pt-2">
          <p className="text-[11px] leading-snug">{active.help}</p>
          {active.legend && (
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
          )}
          <div className="mt-1.5 flex items-start gap-1">
            <ProvenanceBadge value={active.provenance} title={active.source} />
            <span className="text-[10px] leading-tight text-muted max-sm:hidden">
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
    </details>
  );
}
