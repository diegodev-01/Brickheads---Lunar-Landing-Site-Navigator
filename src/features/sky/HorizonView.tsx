"use client";

import { horizonAt } from "@/domain/visibility/horizon";
import type { BodyVisibility, HorizonMask } from "@/domain/types";

const W = 720;
const H = 220;
const PAD = { l: 34, r: 8, t: 10, b: 22 };

/**
 * Panorama of the local sky: azimuth across, elevation up. The grey silhouette is the real
 * terrain horizon; dots are the Sun/Earth positions across the window (bright = visible).
 */
export function HorizonView({
  horizon,
  sun,
  earth,
}: {
  horizon?: HorizonMask;
  sun: BodyVisibility;
  earth: BodyVisibility;
}) {
  const terrain = Array.from({ length: 361 }, (_, az) => horizonAt(horizon, az));
  const all = [...terrain, ...sun.elevationDeg, ...earth.elevationDeg];
  const lo = Math.floor(Math.min(-1, ...terrain) - 0.5);
  const hi = Math.ceil(Math.min(90, Math.max(2, ...all) + 0.5));
  const x = (az: number) => PAD.l + (az / 360) * (W - PAD.l - PAD.r);
  const y = (el: number) => PAD.t + ((hi - el) / (hi - lo)) * (H - PAD.t - PAD.b);

  const ridge = terrain.map((el, az) => `${x(az).toFixed(1)},${y(el).toFixed(1)}`).join(" ");
  const tickStep = niceStep(hi - lo);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi; v += tickStep) ticks.push(v);

  const track = (v: BodyVisibility, color: string) => {
    const stride = Math.max(1, Math.floor(v.times.length / 240));
    return v.azimuthDeg
      .map((az, i) =>
        i % stride === 0 ? (
          <circle
            key={i}
            cx={x(az)}
            cy={y(v.elevationDeg[i]!)}
            r={1.8}
            fill={color}
            opacity={v.visible[i] ? 0.9 : 0.25}
          />
        ) : null,
      )
      .filter(Boolean);
  };

  const now = (v: BodyVisibility, color: string, label: string) =>
    v.times.length ? (
      <g>
        <circle
          cx={x(v.azimuthDeg[0]!)}
          cy={y(v.elevationDeg[0]!)}
          r={6}
          fill={color}
          stroke="#07090f"
          strokeWidth={2}
        />
        <text
          x={x(v.azimuthDeg[0]!) + 9}
          y={y(v.elevationDeg[0]!) - 7}
          fill={color}
          fontSize={11}
          fontWeight={600}
        >
          {label}
        </text>
      </g>
    ) : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Sun and Earth positions over the terrain horizon"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(t)}
            y2={y(t)}
            stroke={t === 0 ? "#3a4559" : "#1a2130"}
            strokeDasharray={t === 0 ? "4 3" : undefined}
          />
          <text x={PAD.l - 5} y={y(t) + 3} fill="#8b95a8" fontSize={10} textAnchor="end">
            {t}°
          </text>
        </g>
      ))}
      {[0, 90, 180, 270, 360].map((az, i) => (
        <text key={az} x={x(az)} y={H - 6} fill="#8b95a8" fontSize={10} textAnchor="middle">
          {["N", "E", "S", "W", "N"][i]} {az !== 360 ? `${az}°` : ""}
        </text>
      ))}
      {track(sun, "#ffc94a")}
      {track(earth, "#4cc3ff")}
      <polygon
        points={`${x(0)},${y(lo)} ${ridge} ${x(360)},${y(lo)}`}
        fill="#2a3242"
        stroke="#9aa6bd"
        strokeWidth={1}
      />
      {now(sun, "#ffc94a", "Sun")}
      {now(earth, "#4cc3ff", "Earth")}
    </svg>
  );
}

function niceStep(span: number): number {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30]) if (span / s <= 8) return s;
  return 30;
}
