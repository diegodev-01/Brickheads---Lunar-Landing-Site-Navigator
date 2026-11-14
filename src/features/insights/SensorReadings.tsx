"use client";

import { useState } from "react";
import { ProvenanceBadge } from "@/components/ui/Panel";
import {
  iceLevel,
  SENSOR_LABEL,
  type LayerContext,
  type SensorId,
  type SensorLayer,
} from "@/domain/sensors/sensors";

interface Props {
  layers: SensorLayer[];
  cell: number;
  timeMs: number;
  ctx: LayerContext;
}

const ORDER: SensorId[] = ["lidar", "sar", "radiometer", "spectrometer"];

function fmt(v: number, units: string): string {
  if (Number.isNaN(v)) return "no data";
  const digits =
    units === "K" || units === "ppm" ? 0 : units.startsWith("index") || units === "ratio" ? 2 : 1;
  return `${v.toFixed(digits)} ${units.startsWith("index") ? "" : units}`.trim();
}

/** Per-instrument readings at the selected cell, each with its provenance; details behind "Advanced". */
export function SensorReadings({ layers, cell, timeMs, ctx }: Props) {
  const [advanced, setAdvanced] = useState(false);
  const read = (id: string) => {
    const l = layers.find((x) => x.id === id);
    if (!l) return null;
    const r = l.getLayer(undefined, timeMs, ctx);
    return { layer: l, value: r.grid[cell]!, r };
  };

  const ice = read("derived.ice");
  const iceText = ice && !Number.isNaN(ice.value) ? iceLevel(ice.value) : null;

  return (
    <section className="border-b border-line px-4 py-3" aria-label="Sensor readings at this point">
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
          Instrument readings
        </h2>
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          aria-expanded={advanced}
          className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-sun"
        >
          {advanced ? "Simple" : "Advanced"}
        </button>
      </div>

      {iceText && ice && (
        <p className="mb-2 text-sm">
          Surface ice probability:{" "}
          <strong
            className={iceText === "high" ? "text-earth" : iceText === "medium" ? "text-warn" : ""}
          >
            {iceText === "high" ? "▲ High" : iceText === "medium" ? "■ Medium" : "▼ Low"}
          </strong>{" "}
          <ProvenanceBadge value={ice.r.provenance.kind} title={ice.r.provenance.source} />
        </p>
      )}

      <dl className="space-y-1.5 text-[12px]">
        {ORDER.map((sensor) => {
          const items = layers
            .filter((l) => l.sensor === sensor && l.id !== "derived.ice")
            .filter((l) => advanced || !l.id.endsWith("tempAvg"));
          return (
            <div key={sensor}>
              <dt className="text-[10px] tracking-wider text-muted uppercase">
                {SENSOR_LABEL[sensor]}
              </dt>
              {items.map((l) => {
                const r = l.getLayer(undefined, timeMs, ctx);
                const v = r.grid[cell]!;
                return (
                  <dd
                    key={l.id}
                    className="flex items-center justify-between gap-2"
                    title={`${l.description}\nSource: ${r.provenance.source}`}
                  >
                    <span className="truncate">{l.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="font-mono">{fmt(v, r.units)}</span>
                      <ProvenanceBadge value={r.provenance.kind} title={r.provenance.source} />
                    </span>
                  </dd>
                );
              })}
              {advanced &&
                items.map((l) => {
                  const r = l.getLayer(undefined, timeMs, ctx);
                  return (
                    <p key={`${l.id}-src`} className="pl-2 text-[10px] leading-tight text-muted">
                      {l.label}: {r.provenance.source} · confidence {r.confidence}
                      {r.provenance.verified ? "" : " · unverified source"}
                    </p>
                  );
                })}
            </div>
          );
        })}
      </dl>
    </section>
  );
}
