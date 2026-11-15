"use client";

import { Badge, Panel, ProvenanceBadge } from "@/components/ui/Panel";
import type { BodyVisibility, Site, SiteConditions } from "@/domain/types";
import { HorizonView } from "@/features/sky/HorizonView";
import { Timeline } from "@/features/sky/Timeline";
import { formatDateTime, formatDuration } from "@/features/sky/format";

interface Props {
  site: Site;
  conditions: SiteConditions;
  /** Readiness summary for this point (rendered under the header). */
  readiness?: React.ReactNode;
  onRemove?: () => void;
}

/** Point details: identity, Sun/Earth at landing, horizon panorama and clearance timeline. */
export function SiteDetail({ site, conditions, readiness, onRemove }: Props) {
  return (
    <div>
      <section className="border-b border-line px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{site.name}</h2>
            <p className="font-mono text-[11px] text-muted">
              {site.id} · {site.lat.toFixed(3)}°, {site.lon.toFixed(3)}°E
              {site.elevationM !== undefined && ` · ${Math.round(site.elevationM)} m`}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              <ProvenanceBadge value={site.provenance} />
              {site.kind === "custom" && !site.horizon && (
                <Badge tone="warn">smooth-sphere horizon (no terrain)</Badge>
              )}
              {site.kind === "custom" && site.horizon && (
                <Badge>horizon of its 500 m cell (4° bins)</Badge>
              )}
              {site.kind === "reference" && <Badge>reference: crater floor</Badge>}
            </div>
          </div>
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            className="mt-2 text-[11px] text-muted underline hover:text-bad"
          >
            Remove this point
          </button>
        )}
      </section>

      {readiness}

      <Panel title={`At landing · ${formatDateTime(conditions.sun.times[0] ?? 0)}`}>
        <div className="grid grid-cols-2 gap-2">
          <BodyCard
            v={conditions.sun}
            label="Sun"
            color="text-sun"
            setWord="Sunset"
            riseWord="Sunrise"
            gapWord="Longest night"
          />
          <BodyCard
            v={conditions.earth}
            label="Earth"
            color="text-earth"
            setWord="Earthset"
            riseWord="Earthrise"
            gapWord="Longest blackout"
          />
        </div>
      </Panel>

      <Panel title="Sky from the lander (terrain horizon)">
        <HorizonView horizon={site.horizon} sun={conditions.sun} earth={conditions.earth} />
        <p className="mt-1 text-[11px] text-muted">
          Grey = real LOLA terrain silhouette{site.horizon ? "" : " (none: smooth sphere)"}. Dots =
          Sun/Earth through the window, faded when hidden. Big dots = position at landing.
        </p>
      </Panel>

      <Panel title="Above the terrain over the window">
        <Timeline sun={conditions.sun} earth={conditions.earth} />
        <p className="mt-1 text-[11px] text-muted">
          Lines = degrees above the local terrain horizon. Bars = Sun (top) and Earth (bottom) in
          view.
        </p>
      </Panel>

      {site.longTermSunPct !== undefined && (
        <Panel title="Long-term reference (18.6 years, PGDA)">
          <p className="text-xs text-muted">
            Sunlit <span className="text-sun">{site.longTermSunPct}%</span> · Earth visible{" "}
            <span className="text-earth">{site.longTermEarthPct}%</span> of the time on average
            (Mazarico et al. 2011, 60 m maps). Compare with the window above to see how much your
            date matters.
          </p>
        </Panel>
      )}
    </div>
  );
}

function BodyCard({
  v,
  label,
  color,
  setWord,
  riseWord,
  gapWord,
}: {
  v: BodyVisibility;
  label: string;
  color: string;
  setWord: string;
  riseWord: string;
  gapWord: string;
}) {
  const clearance = v.times.length ? v.elevationDeg[0]! - v.horizonDeg[0]! : 0;
  return (
    <div className="rounded border border-line bg-panel-2 p-2">
      <div className={`text-xs font-semibold ${color}`}>
        {label} {v.visibleAtStart ? "in view" : "hidden"}
      </div>
      <div className="font-mono text-lg">{(v.elevationDeg[0] ?? 0).toFixed(1)}°</div>
      <div className="text-[10px] text-muted">
        elevation · {clearance >= 0 ? "+" : ""}
        {clearance.toFixed(1)}° vs terrain
      </div>
      <div className="mt-1 text-[11px]">
        {v.hoursToChange === null
          ? v.visibleAtStart
            ? `No ${setWord.toLowerCase()} in window`
            : `No ${riseWord.toLowerCase()} in window`
          : `${v.visibleAtStart ? setWord : riseWord} in ${formatDuration(v.hoursToChange)}`}
      </div>
      <div className="text-[11px] text-muted">
        In view {Math.round(v.fraction * 100)}% · {gapWord.toLowerCase()}{" "}
        {formatDuration(v.longestGapHours)}
      </div>
    </div>
  );
}
