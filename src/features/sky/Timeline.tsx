"use client";

import type { BodyVisibility } from "@/domain/types";

const W = 720;
const H = 200;
const PAD = { l: 34, r: 8, t: 10, b: 44 };

/**
 * Elevation ABOVE THE TERRAIN over the window (0 = local horizon), with visibility bands below.
 * Positive = in view (power / direct-to-Earth link possible).
 */
export function Timeline({ sun, earth }: { sun: BodyVisibility; earth: BodyVisibility }) {
  const n = sun.times.length;
  if (n < 2) return null;
  const clear = (v: BodyVisibility) => v.elevationDeg.map((e, i) => e - v.horizonDeg[i]!);
  const s = clear(sun);
  const e = clear(earth);
  const lo = Math.floor(Math.min(-1, ...s, ...e));
  const hi = Math.ceil(Math.max(1, ...s, ...e));
  const t0 = sun.times[0]!;
  const t1 = sun.times[n - 1]!;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * (H - PAD.t - PAD.b);
  const line = (vals: number[]) =>
    vals.map((v, i) => `${x(sun.times[i]!).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const band = (v: BodyVisibility, row: number, color: string) => {
    const yy = H - PAD.b + 10 + row * 12;
    const segs: [number, number][] = [];
    let start: number | null = null;
    v.visible.forEach((vis, i) => {
      if (vis && start === null) start = i;
      if ((!vis || i === n - 1) && start !== null) {
        segs.push([start, vis ? i : i - 1]);
        start = null;
      }
    });
    return (
      <g>
        <rect x={PAD.l} y={yy} width={W - PAD.l - PAD.r} height={8} fill="#141a26" />
        {segs.map(([a, b]) => (
          <rect
            key={a}
            x={x(v.times[a]!)}
            y={yy}
            width={Math.max(1, x(v.times[b]!) - x(v.times[a]!))}
            height={8}
            fill={color}
          />
        ))}
      </g>
    );
  };

  const days = (t1 - t0) / 86_400_000;
  const dayStep = days > 60 ? 14 : days > 20 ? 5 : days > 6 ? 1 : 0.25;
  const dayTicks: number[] = [];
  for (let d = 0; d <= days; d += dayStep) dayTicks.push(t0 + d * 86_400_000);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Sun and Earth clearance above terrain over time"
    >
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#3a4559" strokeDasharray="4 3" />
      <text x={PAD.l - 5} y={y(0) + 3} fill="#8b95a8" fontSize={10} textAnchor="end">
        0°
      </text>
      <text x={PAD.l - 5} y={y(hi) + 8} fill="#8b95a8" fontSize={10} textAnchor="end">
        {hi}°
      </text>
      <text x={PAD.l - 5} y={y(lo)} fill="#8b95a8" fontSize={10} textAnchor="end">
        {lo}°
      </text>
      {dayTicks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={PAD.t} y2={H - PAD.b} stroke="#1a2130" />
          <text x={x(t)} y={H - 4} fill="#8b95a8" fontSize={9} textAnchor="middle">
            {new Date(t).toISOString().slice(5, 10)}
          </text>
        </g>
      ))}
      <polyline points={line(e)} fill="none" stroke="#4cc3ff" strokeWidth={1.5} />
      <polyline points={line(s)} fill="none" stroke="#ffc94a" strokeWidth={1.5} />
      {band(sun, 0, "#ffc94a")}
      {band(earth, 1, "#4cc3ff")}
    </svg>
  );
}
