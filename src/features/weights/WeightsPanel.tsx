"use client";

import { Panel } from "@/components/ui/Panel";
import {
  FACTOR_LABEL,
  FACTORS,
  SCORING_PRESETS,
  SLOPE_THETAS,
  type Factor,
  type FactorWeights,
  type ScoringModelConfig,
  type SlopeTheta,
} from "@/domain/scoring/model";

interface Props {
  weights: FactorWeights;
  presetId: string | null;
  model: ScoringModelConfig;
  /** Share of evaluated cells excluded by the hard limits (0..1), when known. */
  excludedShare: number | null;
  onWeight: (id: Factor, value: number) => void;
  onPreset: (id: string) => void;
  onModel: (m: ScoringModelConfig) => void;
}

const HELP: Record<Factor, string> = {
  safety: "Size of the flat landing area, roughness and (simulated) boulder hazard.",
  science: "Distance to a permanently shadowed cold trap and likely surface ice nearby.",
  comms: "Share of time Earth (or the relay) is in view, and the longest blackout.",
  power: "Share of time in sunlight, and the longest night the batteries must survive.",
};

export function WeightsPanel({
  weights,
  presetId,
  model,
  excludedShare,
  onWeight,
  onPreset,
  onModel,
}: Props) {
  const g = model.gates;
  const setGates = (patch: Partial<ScoringModelConfig["gates"]>) =>
    onModel({ ...model, gates: { ...g, ...patch } });

  return (
    <Panel title="What matters for this mission?">
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Scoring presets">
        {SCORING_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPreset(p.id)}
            title={p.description}
            aria-pressed={p.id === presetId}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition focus-visible:outline-2 focus-visible:outline-sun ${
              p.id === presetId
                ? "border-sun bg-sun/15 text-sun"
                : "border-line text-muted hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="mb-2 text-[11px] text-muted">
        {SCORING_PRESETS.find((p) => p.id === presetId)?.description ??
          "Custom weights. They always add up to 100 %."}
      </p>

      <div className="space-y-2">
        {FACTORS.map((f) => (
          <label key={f} className="block text-xs" title={HELP[f]}>
            <span className="flex justify-between">
              <span>{FACTOR_LABEL[f]}</span>
              <span className="font-mono text-muted">{Math.round(weights[f] * 100)} %</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(weights[f] * 100)}
              onChange={(e) => onWeight(f, Number(e.target.value) / 100)}
              className="w-full"
              aria-valuetext={`${Math.round(weights[f] * 100)} percent`}
            />
          </label>
        ))}
      </div>

      <details className="mt-3 rounded border border-line p-2 text-xs">
        <summary className="cursor-pointer font-medium">
          Hard limits{" "}
          {excludedShare !== null && (
            <span className="font-normal text-muted">
              · {Math.round(excludedShare * 100)} % of cells excluded
            </span>
          )}
        </summary>
        <p className="mt-1 mb-2 text-[11px] text-muted">
          A cell that breaks any limit is excluded, whatever its score. Defaults are illustrative,
          not mission requirements.
        </p>
        <fieldset className="space-y-2">
          <legend className="sr-only">Hard limits</legend>
          <Row
            label="Flat landing spot"
            enabled={g.slope.enabled}
            onToggle={(v) => setGates({ slope: { ...g.slope, enabled: v } })}
          >
            <select
              aria-label="Maximum slope"
              value={g.slope.thetaDeg}
              onChange={(e) =>
                setGates({ slope: { ...g.slope, thetaDeg: Number(e.target.value) as SlopeTheta } })
              }
              className="rounded border border-line bg-panel-2 px-1 py-0.5"
            >
              {SLOPE_THETAS.map((t) => (
                <option key={t} value={t}>
                  ≤ {t}°
                </option>
              ))}
            </select>
            {g.slope.mode === "lander" ? (
              <>
                <span className="text-muted">radius ≥</span>
                <input
                  aria-label="Minimum flat radius in metres"
                  type="number"
                  min={20}
                  max={1000}
                  step={10}
                  value={g.slope.radiusM}
                  onChange={(e) =>
                    setGates({
                      slope: { ...g.slope, radiusM: Math.max(20, Number(e.target.value) || 100) },
                    })
                  }
                  className="w-16 rounded border border-line bg-panel-2 px-1 py-0.5 font-mono"
                />
                <span className="text-muted">m</span>
              </>
            ) : (
              <span className="text-muted">over the whole cell (P95)</span>
            )}
          </Row>
          <label className="flex items-center gap-1.5 pl-5 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={g.slope.mode === "p95"}
              onChange={(e) =>
                setGates({ slope: { ...g.slope, mode: e.target.checked ? "p95" : "lander" } })
              }
            />
            Strict: whole 500 m cell (95th-percentile slope)
          </label>
          <Row
            label="Roughness"
            enabled={g.roughness.enabled}
            onToggle={(v) => setGates({ roughness: { ...g.roughness, enabled: v } })}
          >
            <span className="text-muted">≤</span>
            <input
              aria-label="Maximum roughness in degrees"
              type="number"
              min={1}
              max={10}
              step={0.5}
              value={g.roughness.maxDeg}
              onChange={(e) =>
                setGates({ roughness: { ...g.roughness, maxDeg: Number(e.target.value) || 4 } })
              }
              className="w-14 rounded border border-line bg-panel-2 px-1 py-0.5 font-mono"
            />
            <span className="text-muted">°</span>
          </Row>
          <Row
            label="Boulders ◇"
            enabled={g.boulders.enabled}
            onToggle={(v) => setGates({ boulders: { ...g.boulders, enabled: v } })}
          >
            <span className="text-muted">index ≤</span>
            <input
              aria-label="Maximum simulated boulder index"
              type="number"
              min={0.1}
              max={1}
              step={0.05}
              value={g.boulders.max}
              onChange={(e) =>
                setGates({ boulders: { ...g.boulders, max: Number(e.target.value) || 0.6 } })
              }
              className="w-14 rounded border border-line bg-panel-2 px-1 py-0.5 font-mono"
            />
          </Row>
          <Row
            label="Needs radio contact"
            enabled={g.comms.enabled}
            onToggle={(v) => setGates({ comms: { enabled: v } })}
          />
          <Row
            label="Needs some sunlight"
            enabled={g.darkness.enabled}
            onToggle={(v) => setGates({ darkness: { enabled: v } })}
          />
        </fieldset>
        <p className="mt-2 text-[10px] text-muted">◇ = based on simulated data.</p>
      </details>
    </Panel>
  );
}

function Row({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="flex min-w-[9rem] items-center gap-1.5">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        {label}
      </label>
      {enabled && children}
    </div>
  );
}
