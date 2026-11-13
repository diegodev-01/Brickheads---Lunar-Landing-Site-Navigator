"use client";

import { Panel } from "@/components/ui/Panel";
import { FACTOR_IDS, WEIGHT_PRESETS, type FactorId, type Weights } from "@/domain/scoring/config";
import { FACTORS } from "@/domain/scoring/factors";

interface Props {
  weights: Weights;
  presetId: string | null;
  onWeight: (id: FactorId, value: number) => void;
  onPreset: (id: string) => void;
}

export function WeightsPanel({ weights, presetId, onWeight, onPreset }: Props) {
  const preset = WEIGHT_PRESETS.find((p) => p.id === presetId);
  return (
    <Panel title="What matters for this mission?">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {WEIGHT_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => onPreset(p.id)}
            title={p.description}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
              p.id === presetId
                ? "border-sun bg-sun/15 text-sun"
                : "border-line text-muted hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="mb-2 min-h-4 text-[11px] text-muted">
        {preset ? preset.description : "Custom weights"}
      </p>
      <div className="space-y-2">
        {FACTOR_IDS.map((id) => (
          <label
            key={id}
            className="grid grid-cols-[92px_1fr_18px] items-center gap-2 text-xs"
            title={FACTORS[id].why}
          >
            <span>{FACTORS[id].label}</span>
            <input
              type="range"
              min={0}
              max={5}
              step={1}
              value={weights[id]}
              onChange={(e) => onWeight(id, Number(e.target.value))}
              aria-label={`Weight for ${FACTORS[id].label}`}
            />
            <span className="text-right font-mono text-muted">{weights[id]}</span>
          </label>
        ))}
      </div>
    </Panel>
  );
}
