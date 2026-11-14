"use client";

import { useId } from "react";
import type { Aim } from "@/domain/orbit/aim";
import { formatLonLat } from "./format";

interface Props {
  aim: Aim;
  onAim: (aim: Aim) => void;
}

/** Yaw and pitch as two sliders with exact number boxes, plus the landing point they produce. */
export function AimControls({ aim, onAim }: Props) {
  return (
    <section
      aria-label="Landing point controls"
      className="grid gap-x-5 gap-y-2 border-t border-line bg-panel px-3 py-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      <AngleInput
        label="Yaw"
        hint="turn left / right around the Moon"
        min={0}
        max={359.9}
        value={aim.yawDeg}
        onChange={(yawDeg) => onAim({ ...aim, yawDeg })}
        ends={["0° facing Earth", "180° far side", "360°"]}
      />
      <AngleInput
        label="Pitch"
        hint="tilt down / up between the poles"
        min={-90}
        max={90}
        value={aim.pitchDeg}
        onChange={(pitchDeg) => onAim({ ...aim, pitchDeg })}
        ends={["-90° south pole", "0° equator", "+90° north pole"]}
      />
      <div className="text-xs leading-tight" aria-live="polite">
        <div className="text-muted">Landing point</div>
        <div className="font-mono text-sm text-sun">{formatLonLat(aim)}</div>
      </div>
    </section>
  );
}

function AngleInput({
  label,
  hint,
  min,
  max,
  value,
  onChange,
  ends,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  ends: [string, string, string];
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs">
          <strong className="text-sm">{label}</strong> <span className="text-muted">· {hint}</span>
        </label>
        <span className="flex items-center gap-0.5">
          <input
            type="number"
            aria-label={`${label} in degrees`}
            min={min}
            max={max}
            step={0.01}
            value={Number(value.toFixed(2))}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (e.target.value !== "" && Number.isFinite(n)) onChange(n);
            }}
            className="w-20 rounded border border-line bg-panel-2 px-1.5 py-0.5 text-right font-mono text-sm"
          />
          <span className="text-sm text-muted">°</span>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        aria-valuetext={`${value.toFixed(1)} degrees`}
      />
      <div className="flex justify-between text-[10px] text-muted" aria-hidden="true">
        {ends.map((e) => (
          <span key={e}>{e}</span>
        ))}
      </div>
    </div>
  );
}
