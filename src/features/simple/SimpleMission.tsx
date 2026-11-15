"use client";

import { useId } from "react";
import type { TimeWindow } from "@/domain/types";

interface Props {
  startMs: number;
  windowDays: number;
  presetId: string | null;
  coverage: TimeWindow;
  presets: readonly { id: string; label: string; description: string }[];
  onStart: (ms: number) => void;
  onDays: (days: number) => void;
  onPreset: (id: string) => void;
}

const STAYS = [
  { days: 1, label: "1 day" },
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 29.53, label: "1 month (a full lunar day)" },
  { days: 60, label: "2 months" },
];

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Three everyday questions instead of the full mission form. */
export function SimpleMission({
  startMs,
  windowDays,
  presetId,
  coverage,
  presets,
  onStart,
  onDays,
  onPreset,
}: Props) {
  const uid = useId();
  const field = "w-full rounded border border-line bg-panel-2 px-2 py-1.5 text-sm";
  return (
    <div className="space-y-5 px-4 py-4">
      <section>
        <h2 className="text-base font-semibold">Plan your landing</h2>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[13px] text-muted">
          <li>Answer the three questions below.</li>
          <li>Pick a spot on the Moon map (click it, or use Yaw and Pitch).</li>
          <li>Read the answer on the right.</li>
        </ol>
      </section>

      <div>
        <label htmlFor={`${uid}-date`} className="mb-1 block text-sm font-medium">
          1. When do you land?
        </label>
        <input
          id={`${uid}-date`}
          type="date"
          value={day(startMs)}
          min={day(coverage.startMs)}
          max={day(coverage.endMs)}
          onChange={(e) => {
            const ms = Date.parse(`${e.target.value}T00:00:00Z`);
            if (Number.isFinite(ms)) onStart(ms);
          }}
          className={field}
        />
        <p className="mt-1 text-[11px] text-muted">
          Sun and Earth positions are available from {day(coverage.startMs)} to{" "}
          {day(coverage.endMs)}.
        </p>
      </div>

      <div>
        <label htmlFor={`${uid}-stay`} className="mb-1 block text-sm font-medium">
          2. How long do you stay?
        </label>
        <select
          id={`${uid}-stay`}
          value={windowDays}
          onChange={(e) => onDays(Number(e.target.value))}
          className={field}
        >
          {STAYS.map((s) => (
            <option key={s.days} value={s.days}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">3. What matters most?</legend>
        <div className="space-y-1.5">
          {presets.map((p) => (
            <label
              key={p.id}
              className={`flex cursor-pointer gap-2 rounded-md border px-2.5 py-1.5 has-focus-visible:outline-2 has-focus-visible:outline-sun ${
                p.id === presetId ? "border-sun bg-sun/10" : "border-line hover:border-muted"
              }`}
            >
              <input
                type="radio"
                name={`${uid}-preset`}
                checked={p.id === presetId}
                onChange={() => onPreset(p.id)}
                className="mt-1 accent-sun"
              />
              <span>
                <span className="block text-sm">{p.label}</span>
                <span className="block text-[12px] leading-snug text-muted">{p.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
