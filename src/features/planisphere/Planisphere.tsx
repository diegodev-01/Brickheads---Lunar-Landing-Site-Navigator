"use client";

import { useCallback, useMemo, useRef } from "react";
import { aimToPlanisphere, planisphereToAim, type Aim } from "@/domain/orbit/aim";
import type { LonLat } from "@/domain/types";

interface Props {
  /** Equirectangular image of the whole Moon, centred on longitude 0° (north up). */
  imageUrl: string;
  aim: Aim;
  onAim: (aim: Aim) => void;
  /** Latitude (°) below which the detailed landing analysis is available. */
  detailMaxLatDeg: number;
  onOpenDetail: () => void;
  /** Point where the Sun is straight overhead at the landing time (draws day and night). */
  sun: LonLat | null;
  /** Point where Earth is straight overhead at the landing time. */
  earth: LonLat | null;
}

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Night side as an SVG path in a 360 × 180 box (x = lon + 180, y = 90 − lat). */
function nightPath(sun: LonLat): string {
  // Keep the Sun slightly off the equator so the terminator stays a single-valued curve.
  const lat = Math.abs(sun.lat) < 0.05 ? 0.05 * (sun.lat < 0 ? -1 : 1) : sun.lat;
  const t = Math.tan(toRad(lat));
  const pts: string[] = [];
  for (let x = 0; x <= 360; x += 2) {
    const lon = x - 180;
    const b = toDeg(Math.atan(-Math.cos(toRad(lon - sun.lon)) / t));
    pts.push(`${x},${(90 - b).toFixed(2)}`);
  }
  // Night lies on the pole opposite to the Sun's latitude.
  const edge = lat > 0 ? 180 : 0;
  return `M0,${edge} L${pts.join(" L")} L360,${edge} Z`;
}

/**
 * The whole Moon unrolled flat. Click or drag to choose the landing point: left/right changes the
 * yaw (longitude), up/down changes the pitch (latitude).
 */
export function Planisphere({
  imageUrl,
  aim,
  onAim,
  detailMaxLatDeg,
  onOpenDetail,
  sun,
  earth,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const aimAt = useCallback(
    (clientX: number, clientY: number) => {
      const r = box.current?.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0) return;
      onAim(planisphereToAim((clientX - r.left) / r.width, (clientY - r.top) / r.height));
    },
    [onAim],
  );

  const { u, v } = aimToPlanisphere(aim);
  const night = useMemo(() => (sun ? nightPath(sun) : null), [sun]);
  const pos = (p: LonLat) => {
    const q = aimToPlanisphere({ yawDeg: p.lon, pitchDeg: p.lat });
    return { left: `${q.u * 100}%`, top: `${q.v * 100}%` };
  };
  const bandPct = Math.max(0, ((90 + detailMaxLatDeg) / 180) * 100);

  return (
    <div
      className="grid h-full w-full place-items-center bg-black p-2"
      style={{ containerType: "size" }}
    >
      <div
        ref={box}
        role="application"
        tabIndex={0}
        aria-label={`Map of the whole Moon. Landing point at yaw ${aim.yawDeg.toFixed(1)} degrees, pitch ${aim.pitchDeg.toFixed(1)} degrees. Use the arrow keys to move it.`}
        className="relative cursor-crosshair touch-none overflow-hidden rounded-md outline-offset-2 select-none focus-visible:outline-2 focus-visible:outline-sun"
        style={{ width: "min(100cqw, 200cqh)", aspectRatio: "2 / 1" }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          aimAt(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (dragging.current) aimAt(e.clientX, e.clientY);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 1;
          const d: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
          };
          const m = d[e.key];
          if (!m) return;
          e.preventDefault();
          onAim({ yawDeg: aim.yawDeg + m[0], pitchDeg: aim.pitchDeg + m[1] });
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static asset drawn at an exact 2:1 box */}
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />

        <svg
          viewBox="0 0 360 180"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {night && <path d={night} fill="rgba(3,5,12,0.55)" />}
          {[30, 60, 90, 120, 150, 210, 240, 270, 300, 330].map((x) => (
            <line
              key={`v${x}`}
              x1={x}
              x2={x}
              y1={0}
              y2={180}
              stroke="rgba(255,255,255,0.14)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {[30, 60, 120, 150].map((y) => (
            <line
              key={`h${y}`}
              x1={0}
              x2={360}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.14)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* Equator and the Earth-facing meridian: the zero lines for pitch and yaw. */}
          <line
            x1={0}
            x2={360}
            y1={90}
            y2={90}
            stroke="rgba(255,255,255,0.4)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={180}
            x2={180}
            y1={0}
            y2={180}
            stroke="rgba(255,255,255,0.4)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <MapLabel className="top-1 left-1/2 -translate-x-1/2">North pole</MapLabel>
        <MapLabel className="top-1/2 left-1/2 mt-1 ml-1">Side facing Earth</MapLabel>
        <MapLabel className="top-1/2 left-1 mt-1">Far side</MapLabel>
        <MapLabel className="top-1/2 right-1 mt-1">Far side</MapLabel>

        {sun && (
          <span
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-lg drop-shadow"
            style={pos(sun)}
            title="The Sun is straight overhead here at landing time"
            aria-hidden="true"
          >
            ☀️
          </span>
        )}
        {earth && (
          <span
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-lg drop-shadow"
            style={pos(earth)}
            title="Earth is straight overhead here at landing time"
            aria-hidden="true"
          >
            🌍
          </span>
        )}

        {/* South-pole band with detailed data. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-dashed border-sun bg-sun/25"
          style={{ height: `max(${bandPct}%, 5px)` }}
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={onOpenDetail}
          className="absolute bottom-2.5 left-1/2 -translate-x-1/2 cursor-pointer rounded-full border border-sun bg-panel/90 px-3 py-1 text-xs font-medium whitespace-nowrap text-sun shadow-lg hover:bg-sun hover:text-background focus-visible:outline-2 focus-visible:outline-sun"
        >
          ▼ South pole zone: full landing check here · Zoom in
        </button>

        {/* Guide lines: the vertical one is the yaw, the horizontal one the pitch. */}
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-sun/60"
          style={{ left: `${u * 100}%` }}
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-x-0 h-px bg-sun/60"
          style={{ top: `${v * 100}%` }}
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sun bg-sun/25 shadow-[0_0_0_2px_rgba(7,9,15,0.8)]"
          style={{ left: `${u * 100}%`, top: `${v * 100}%` }}
          aria-hidden="true"
        >
          <span className="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sun" />
        </div>
      </div>
    </div>
  );
}

function MapLabel({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={`pointer-events-none absolute rounded bg-black/55 px-1.5 py-px text-[10px] tracking-wide whitespace-nowrap text-white/80 uppercase ${className}`}
    >
      {children}
    </span>
  );
}
