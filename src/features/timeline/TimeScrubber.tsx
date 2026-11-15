"use client";

import { useEffect, useRef, useState } from "react";
import type { PointSeries } from "@/domain/illumination/illumination";
import type { TimeWindow } from "@/domain/types";

const HOUR = 3_600_000;
const SPEEDS = [
  { hoursPerSec: 1, label: "1 h/s" },
  { hoursPerSec: 6, label: "6 h/s" },
  { hoursPerSec: 24, label: "1 day/s" },
  { hoursPerSec: 72, label: "3 days/s" },
];

interface Props {
  window: TimeWindow;
  timeMs: number;
  onTime: (ms: number) => void;
  /** Map bearing the sunlight comes from (clockwise from map-up), and Sun elevation near the pole. */
  sun: { bearingDeg: number; elevationDeg: number } | null;
  /** Sun series at the selected point (null when nothing is selected). */
  series: PointSeries | null;
  pointLabel: string | null;
}

const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function TimeScrubber({ window: win, timeMs, onTime, sun, series, pointLabel }: Props) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timeRef = useRef(timeMs);
  useEffect(() => {
    timeRef.current = timeMs;
  }, [timeMs]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let next = timeRef.current + dt * SPEEDS[speed]!.hoursPerSec * HOUR;
      if (next > win.endMs) next = win.startMs; // loop
      onTime(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, win.startMs, win.endMs, onTime]);

  const spanH = Math.max(1, (win.endMs - win.startMs) / HOUR);
  const idx = series
    ? Math.min(series.visible.length - 1, Math.max(0, Math.round((timeMs - win.startMs) / HOUR)))
    : 0;
  const litNow = series ? series.visible[idx]! : null;

  return (
    <section
      aria-label="Time scrubber: light and shadow simulator"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-panel px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="grid h-9 w-9 place-items-center rounded-full border border-sun/70 text-sun hover:bg-sun/10 focus-visible:outline-2 focus-visible:outline-sun"
          aria-label={playing ? "Pause" : "Play"}
          aria-pressed={playing}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <label className="sr-only" htmlFor="scrub-speed">
          Playback speed
        </label>
        <select
          id="scrub-speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="rounded border border-line bg-panel-2 px-1.5 py-1 text-xs"
        >
          {SPEEDS.map((s, i) => (
            <option key={s.label} value={i}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-[14rem] flex-1">
        <div className="flex justify-between text-[11px]">
          <span className="font-mono">{fmt(timeMs)}</span>
          <span className="text-muted">
            +{Math.round((timeMs - win.startMs) / HOUR)} h of {Math.round(spanH)} h
          </span>
        </div>
        <div className="relative">
          {series && <Sparkline series={series} />}
          <input
            type="range"
            min={win.startMs}
            max={win.endMs}
            step={HOUR}
            value={timeMs}
            onChange={(e) => onTime(Number(e.target.value))}
            className="relative z-10 w-full"
            aria-label="Time within the mission window"
            aria-valuetext={fmt(timeMs)}
          />
        </div>
      </div>

      {sun && <SunCompass bearingDeg={sun.bearingDeg} elevationDeg={sun.elevationDeg} />}

      <div className="min-w-[10rem] text-[11px] leading-tight" aria-live="polite">
        {series && pointLabel ? (
          <>
            <div className="truncate text-muted">{pointLabel}</div>
            <div>
              Sunlit now:{" "}
              <strong className={litNow && litNow > 0.5 ? "text-sun" : "text-muted"}>
                {litNow === null ? "–" : `${Math.round(litNow * 100)} %`}
              </strong>
            </div>
            <div>
              Window average: <strong>{Math.round(series.fraction * 100)} %</strong>
            </div>
          </>
        ) : (
          <span className="text-muted">
            Select a point on the map to see its sunlight over time.
          </span>
        )}
      </div>
    </section>
  );
}

/** Illuminated fraction over the window, drawn behind the slider track. */
function Sparkline({ series }: { series: PointSeries }) {
  const n = series.visible.length;
  if (n < 2) return null;
  const pts = series.visible.map((v, i) => `${(i / (n - 1)) * 100},${20 - v * 18}`).join(" ");
  return (
    <svg
      viewBox="0 0 100 20"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 -top-1 h-6 w-full"
      aria-hidden="true"
    >
      <polyline points={`0,20 ${pts} 100,20`} fill="rgba(255,201,74,0.18)" stroke="none" />
      <polyline
        points={pts}
        fill="none"
        stroke="#ffc94a"
        strokeWidth="0.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Map-north-up compass showing where sunlight comes from. */
function SunCompass({ bearingDeg, elevationDeg }: { bearingDeg: number; elevationDeg: number }) {
  const up = elevationDeg > 0;
  return (
    <div
      className="flex items-center gap-2"
      role="img"
      aria-label={`Sun from map bearing ${Math.round(bearingDeg)}°, ${elevationDeg.toFixed(1)}° above the horizon at the pole`}
    >
      <svg viewBox="-20 -20 40 40" className="h-10 w-10" aria-hidden="true">
        <circle r="17" fill="none" stroke="#232b3b" strokeWidth="2" />
        <text y="-11" textAnchor="middle" fontSize="6" fill="#8b95a8">
          0°
        </text>
        <g transform={`rotate(${bearingDeg})`}>
          <line y1="0" y2="-13" stroke={up ? "#ffc94a" : "#8b95a8"} strokeWidth="2" />
          <circle
            cy="-15"
            r="3.5"
            fill={up ? "#ffc94a" : "none"}
            stroke="#ffc94a"
            strokeWidth="1.2"
          />
        </g>
      </svg>
      <div className="text-[11px] leading-tight">
        <div>Sun from {Math.round(bearingDeg)}°E</div>
        <div className="text-muted">
          {elevationDeg >= 0 ? "▲" : "▼"} {Math.abs(elevationDeg).toFixed(1)}° at pole
        </div>
      </div>
    </div>
  );
}
