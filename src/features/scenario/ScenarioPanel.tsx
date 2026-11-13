"use client";

import { Panel } from "@/components/ui/Panel";
import { formatDate } from "@/features/sky/format";
import { LUNAR_DAY_DAYS } from "./useNavigator";

const WINDOWS = [
  { days: 1, label: "1 day" },
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: LUNAR_DAY_DAYS, label: "1 lunar day (29.5 d)" },
  { days: 90, label: "3 months" },
];

interface Props {
  window: { startMs: number; endMs: number };
  windowDays: number;
  coverage: { startMs: number; endMs: number };
  onStart: (ms: number) => void;
  onDays: (days: number) => void;
}

export function ScenarioPanel({ window, windowDays, coverage, onStart, onDays }: Props) {
  const shift = (days: number) => onStart(window.startMs + days * 86_400_000);
  return (
    <Panel title="Landing date & mission window">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          type="date"
          value={formatDate(window.startMs)}
          min={formatDate(coverage.startMs)}
          max={formatDate(coverage.endMs)}
          onChange={(e) => e.target.value && onStart(Date.parse(`${e.target.value}T00:00:00Z`))}
          className="rounded border border-line bg-panel-2 px-2 py-1 text-sm"
          aria-label="Landing date (UTC)"
        />
        <select
          value={windowDays}
          onChange={(e) => onDays(Number(e.target.value))}
          className="rounded border border-line bg-panel-2 px-2 py-1 text-sm"
          aria-label="Mission window length"
        >
          {WINDOWS.map((w) => (
            <option key={w.days} value={w.days}>
              {w.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs">
        <span className="text-muted">Slip launch:</span>
        {[-7, -1, 1, 7, 14].map((d) => (
          <button
            key={d}
            onClick={() => shift(d)}
            className="rounded border border-line px-1.5 py-0.5 font-mono hover:border-sun hover:text-sun"
            title={`Move the landing date by ${d} day(s)`}
          >
            {d > 0 ? `+${d}` : d}d
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Window {formatDate(window.startMs)} → {formatDate(window.endMs)} UTC. Ephemeris covers{" "}
        {formatDate(coverage.startMs)} – {formatDate(coverage.endMs)}.
      </p>
    </Panel>
  );
}
