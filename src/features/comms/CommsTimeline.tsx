"use client";

import { useState } from "react";
import { Panel, ProvenanceBadge } from "@/components/ui/Panel";
import { achievableRateBps, BANDS, NRHO_9_2_SOUTH, type BandConfig } from "@/domain/comms/relay";
import type { RelayPointSeries } from "@/domain/comms/relayGrid";
import type { PointSeries } from "@/domain/illumination/illumination";
import { fmtHours } from "@/domain/scoring/explainCell";
import type { TimeWindow } from "@/domain/types";

interface Props {
  window: TimeWindow;
  relay: RelayPointSeries;
  earth: PointSeries;
  /** Current scrubber time, drawn as a cursor. */
  timeMs: number;
}

const W = 340;
const ROW = 16;

function fmtRate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "–";
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1)} Mbit/s`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} kbit/s`;
  return `${bps.toFixed(0)} bit/s`;
}

/** Longest stretch with no contact, from a boolean series with a fixed step. */
function longestGapH(flags: boolean[], stepMs: number): number {
  let run = 0;
  let best = 0;
  for (const f of flags) {
    run = f ? 0 : run + 1;
    best = Math.max(best, run);
  }
  return (best * stepMs) / 3_600_000;
}

/** Contact windows and blackouts for the relay and direct-to-Earth, over the mission window. */
export function CommsTimeline({ window: win, relay, earth, timeMs }: Props) {
  const [bandId, setBandId] = useState<BandConfig["id"]>("S");
  const band = BANDS[bandId];
  const span = Math.max(1, win.endMs - win.startMs);
  const X = (t: number) => ((t - win.startMs) / span) * W;

  const earthVisible = earth.visible.map((v) => v >= 0.5);
  const earthStep = earth.times.length > 1 ? earth.times[1]! - earth.times[0]! : 3_600_000;
  const lat = relay.latencyS.filter((x) => !Number.isNaN(x));
  const ranges = relay.rangeKm.filter((_, i) => relay.contact[i]);
  const meanRange = ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : Number.NaN;
  const orbits: number[] = [];
  for (let t = NRHO_9_2_SOUTH.periluneEpochMs; t < win.endMs; t += NRHO_9_2_SOUTH.periodS * 1000) {
    if (t >= win.startMs) orbits.push(t);
  }
  const days = Math.round(span / 86_400_000);

  return (
    <Panel
      title="Comms timeline"
      right={<ProvenanceBadge value="simulated" title="Relay orbit is a simplified NRHO proxy" />}
    >
      <svg
        viewBox={`0 0 ${W} ${ROW * 2 + 26}`}
        className="w-full"
        role="img"
        aria-label={`Relay contact ${relay.windows.length} windows; Earth in view ${Math.round(earth.fraction * 100)} % of the window`}
      >
        {[
          { y: 2, label: "Relay", color: "#7ad151", windows: relay.windows },
          {
            y: ROW + 8,
            label: "Earth",
            color: "#4cc3ff",
            windows: groups(earth.times, earthVisible, earthStep),
          },
        ].map((r) => (
          <g key={r.label}>
            <rect x={0} y={r.y} width={W} height={ROW} fill="#141a26" />
            {r.windows.map((w) => (
              <rect
                key={w.startMs}
                x={X(w.startMs)}
                y={r.y}
                width={Math.max(0.8, X(w.endMs) - X(w.startMs))}
                height={ROW}
                fill={r.color}
              />
            ))}
            <text
              x={3}
              y={r.y + 11}
              fontSize="9"
              fill="#07090f"
              stroke="#e6e9f0"
              strokeWidth="2.5"
              paintOrder="stroke"
            >
              {r.label}
            </text>
          </g>
        ))}
        {orbits.map((t) => (
          <line
            key={t}
            x1={X(t)}
            x2={X(t)}
            y1={0}
            y2={ROW * 2 + 12}
            stroke="#8b95a8"
            strokeDasharray="2 2"
            strokeWidth="0.8"
          />
        ))}
        <line
          x1={X(timeMs)}
          x2={X(timeMs)}
          y1={0}
          y2={ROW * 2 + 12}
          stroke="#ffc94a"
          strokeWidth="1.5"
        />
        <text x={0} y={ROW * 2 + 24} fontSize="9" fill="#8b95a8">
          day 0
        </text>
        <text x={W} y={ROW * 2 + 24} fontSize="9" fill="#8b95a8" textAnchor="end">
          day {days} · dashed = relay perilune (orbit start)
        </text>
      </svg>
      <p className="mt-1 text-[11px] text-muted">
        Filled = contact, dark = blackout. Yellow line = scrubber time.
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-muted">Relay contact per orbit</dt>
        <dd className="font-mono">{fmtHours(relay.minutesPerOrbit / 60)}</dd>
        <dt className="text-muted">Longest relay blackout</dt>
        <dd className="font-mono">{fmtHours(longestGapH(relay.contact, relay.stepMs))}</dd>
        <dt className="text-muted">Earth (direct) in view</dt>
        <dd className="font-mono">{Math.round(earth.fraction * 100)} %</dd>
        <dt className="text-muted">Longest Earth blackout</dt>
        <dd className="font-mono">{fmtHours(longestGapH(earthVisible, earthStep))}</dd>
        <dt className="text-muted" title="Light time lander → relay → Earth (no processing delay)">
          One-way latency via relay
        </dt>
        <dd className="font-mono">
          {lat.length ? `${Math.min(...lat).toFixed(2)}–${Math.max(...lat).toFixed(2)} s` : "–"}
        </dd>
        <dt className="text-muted">
          <label htmlFor="band">Data rate (</label>
          <select
            id="band"
            value={bandId}
            onChange={(e) => setBandId(e.target.value as BandConfig["id"])}
            className="rounded border border-line bg-panel-2 px-0.5 text-[11px]"
          >
            {Object.values(BANDS).map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          )
        </dt>
        <dd
          className="font-mono"
          title={`At mean contact range ${Math.round(meanRange).toLocaleString()} km; EIRP ${band.landerEirpDbw} dBW, G/T ${band.relayGtDbK} dB/K, ${band.marginDb} dB margin`}
        >
          {fmtRate(achievableRateBps(meanRange, band))}
        </dd>
      </dl>
    </Panel>
  );
}

function groups(times: number[], vis: boolean[], step: number) {
  const out: { startMs: number; endMs: number }[] = [];
  let cur: { startMs: number; endMs: number } | null = null;
  times.forEach((t, i) => {
    if (vis[i]) {
      if (cur) cur.endMs = t + step;
      else cur = { startMs: t, endMs: t + step };
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  });
  if (cur) out.push(cur);
  return out;
}
