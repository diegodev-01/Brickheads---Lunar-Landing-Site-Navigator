"use client";

import type { RasterLayerMeta } from "@/data";
import { ProvenanceBadge } from "@/components/ui/Panel";

export function LayerToggle({
  layers,
  activeId,
  onChange,
}: {
  layers: RasterLayerMeta[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  const active = layers.find((l) => l.id === activeId);
  const options = [
    { id: "none", label: "Terrain only" },
    ...layers.filter((l) => l.id !== "hillshade"),
  ];
  return (
    <details
      open
      className="w-44 rounded-md border border-line bg-panel/90 p-2 text-xs shadow-lg backdrop-blur sm:w-60"
    >
      <summary className="mb-1.5 cursor-pointer text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
        Map layer
      </summary>
      <div className="space-y-0.5">
        {options.map((l) => (
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
            />
            {l.label}
          </label>
        ))}
      </div>
      {active?.legend && (
        <div className="mt-2">
          <div
            className="h-2 rounded"
            style={{ background: `linear-gradient(to right, ${active.legend.stops.join(", ")})` }}
          />
          {active.id !== "psr" && (
            <div className="mt-0.5 flex justify-between font-mono text-[10px] text-muted">
              <span>
                {active.legend.min}
                {active.legend.unit}
              </span>
              <span>
                {active.legend.max}
                {active.legend.unit}
              </span>
            </div>
          )}
          <div className="mt-1 flex items-start gap-1">
            <ProvenanceBadge value={active.provenance} />
            <span className="text-[10px] leading-tight text-muted max-sm:hidden">
              {active.source}
            </span>
          </div>
        </div>
      )}
    </details>
  );
}
