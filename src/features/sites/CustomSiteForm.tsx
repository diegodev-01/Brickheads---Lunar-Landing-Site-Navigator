"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import type { LonLat } from "@/domain/types";

/** Add any lunar coordinate. Outside the precomputed region it gets ephemeris-only analysis. */
export function CustomSiteForm({ onAdd }: { onAdd: (p: LonLat) => void }) {
  const [lat, setLat] = useState("-89.45");
  const [lon, setLon] = useState("222.7");
  const latN = Number(lat);
  const lonN = Number(lon);
  const valid = Number.isFinite(latN) && Number.isFinite(lonN) && latN >= -90 && latN <= 90;
  return (
    <Panel title="Custom coordinates">
      <form
        className="grid grid-cols-[1fr_1fr_auto] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onAdd({ lat: latN, lon: ((lonN % 360) + 360) % 360 });
        }}
      >
        <input
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          inputMode="decimal"
          className="rounded border border-line bg-panel-2 px-2 py-1 font-mono text-sm"
          aria-label="Latitude (degrees, south negative)"
          placeholder="lat"
        />
        <input
          value={lon}
          onChange={(e) => setLon(e.target.value)}
          inputMode="decimal"
          className="rounded border border-line bg-panel-2 px-2 py-1 font-mono text-sm"
          aria-label="East longitude (degrees)"
          placeholder="lon °E"
        />
        <button
          disabled={!valid}
          className="rounded border border-sun/60 px-2 text-xs text-sun hover:bg-sun/10 disabled:opacity-40"
        >
          Add
        </button>
      </form>
      <p className="mt-1.5 text-[11px] text-muted">
        Latitude, east longitude (°). Or click empty ground on the map. Custom sites use a
        smooth-sphere horizon (terrain not precomputed), so Sun/Earth % are optimistic and terrain
        factors are not scored.
      </p>
    </Panel>
  );
}
