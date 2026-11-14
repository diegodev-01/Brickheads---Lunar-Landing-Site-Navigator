"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo } from "react";
import { ProvenanceBadge } from "@/components/ui/Panel";
import { cellIndexAt, type Extent } from "@/domain/grid/grid";
import { xyToLonLat } from "@/domain/geo/polarStereo";
import type { MissionSetup } from "@/domain/mission/setup";
import { WEIGHT_PRESETS } from "@/domain/scoring/config";
import type { LonLat } from "@/domain/types";
import { useAnalysis } from "./analysis/useAnalysis";
import { paintGrid, paletteLut } from "./map/heatmap";
import { GRID_LAYERS, isGridLayer, staticEntries } from "./map/layerCatalog";
import { LayerToggle } from "./map/LayerToggle";
import { useDataset, type Dataset } from "./scenario/useDataset";
import { useNavigator } from "./scenario/useNavigator";
import { MissionSetupPanel, type SetupValues } from "./setup/MissionSetupPanel";
import { SiteDetail } from "./sites/SiteDetail";
import { SiteList } from "./sites/SiteList";
import { TimeScrubber } from "./timeline/TimeScrubber";
import { WeightsPanel } from "./weights/WeightsPanel";

// OpenLayers touches `window`: render the map on the client only.
const LunarMap = dynamic(() => import("./map/LunarMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-sm text-muted">Loading map…</div>
  ),
});

const LUTS = Object.fromEntries(GRID_LAYERS.map((l) => [l.id, paletteLut(l.palette)]));

export function NavigatorApp() {
  const ds = useDataset();
  if (ds.status === "loading")
    return (
      <div className="grid flex-1 place-items-center text-sm text-muted" role="status">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-line border-t-sun" />
          Loading lunar terrain, Sun and Earth data…
        </div>
      </div>
    );
  if (ds.status === "error")
    return (
      <div className="grid flex-1 place-items-center text-sm text-bad" role="alert">
        Could not load data: {ds.message}
      </div>
    );
  return <Navigator data={ds.data} />;
}

/** Window sampling step: keeps ~350 samples per window so a recompute stays well under a second. */
const stepFor = (days: number) => (days <= 14 ? 1 : days <= 30 ? 2 : 4);

function Navigator({ data }: { data: Dataset }) {
  const nav = useNavigator(data);
  const { state, dispatch, selected } = nav;
  const geometry = data.grid.geometry;
  const analysis = useAnalysis(nav.window, stepFor(state.windowDays));
  const { requestSnapshot, requestSeries } = analysis;

  const onSelect = useCallback((id: string | null) => dispatch({ type: "select", id }), [dispatch]);
  const onPickPoint = useCallback(
    (x: number, y: number) =>
      dispatch({ type: "addCustom", site: nav.makeCustomSite(xyToLonLat(x, y)) }),
    [dispatch, nav],
  );
  const onTime = useCallback((ms: number) => dispatch({ type: "scrub", ms }), [dispatch]);

  const selectedCell = selected ? cellIndexAt(geometry, selected.site.x, selected.site.y) : null;

  // Worker requests.
  useEffect(() => {
    if (analysis.status === "ready") requestSnapshot(state.scrubMs);
  }, [analysis.status, state.scrubMs, requestSnapshot]);
  useEffect(() => {
    if (analysis.status === "ready") requestSeries(selectedCell);
  }, [analysis.status, selectedCell, nav.window, requestSeries]);

  // Heatmap canvas for the active computed layer.
  const gridOverlay = useMemo(() => {
    if (!isGridLayer(state.layerId)) return null;
    const values =
      state.layerId === "illumNow"
        ? analysis.snapshot?.sun
        : state.layerId === "earthWindow"
          ? analysis.windowResult?.earthFraction
          : analysis.windowResult?.sunFraction;
    if (!values) return null;
    const canvas = paintGrid(
      document.createElement("canvas"),
      geometry,
      values,
      0,
      1,
      LUTS[state.layerId]!,
    );
    return { canvas, extent: geometry.extentM, version: 0 };
  }, [state.layerId, analysis.snapshot, analysis.windowResult, geometry]);

  const roi: Extent | null = useMemo(() => {
    if (!selected) return null;
    const h = state.roiHalfKm * 1000;
    const [x0, y0, x1, y1] = geometry.extentM;
    const { x, y } = selected.site;
    return [Math.max(x0, x - h), Math.max(y0, y - h), Math.min(x1, x + h), Math.min(y1, y + h)];
  }, [selected, state.roiHalfKm, geometry]);

  const layers = useMemo(
    () => [...GRID_LAYERS, ...staticEntries(data.region.layers)],
    [data.region.layers],
  );

  const setupValues: SetupValues = useMemo(
    () => ({
      timeMs: nav.window.startMs,
      windowDays: state.windowDays,
      roiHalfKm: state.roiHalfKm,
      presetId: state.presetId ?? WEIGHT_PRESETS[0]!.id,
      target: selected ? { lat: selected.site.lat, lon: selected.site.lon } : null,
    }),
    [nav.window.startMs, state.windowDays, state.roiHalfKm, state.presetId, selected],
  );

  const onApplySetup = useCallback(
    (s: MissionSetup) => {
      const same =
        selected &&
        Math.abs(selected.site.lat - s.target.lat) < 1e-4 &&
        Math.abs(selected.site.lon - s.target.lon) < 1e-4;
      dispatch({
        type: "applySetup",
        startMs: s.timeMs,
        days: (s.window.endMs - s.window.startMs) / 86_400_000,
        roiHalfKm: s.roiHalfKm,
        presetId: s.presetId,
        site: same ? undefined : nav.makeCustomSite(s.target as LonLat),
      });
    },
    [dispatch, nav, selected],
  );

  const targetElevation =
    selectedCell !== null ? data.grid.fields.elevation.data[selectedCell]! : null;

  return (
    <div className="flex min-h-dvh flex-col xl:h-dvh">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            Lunar Landing Site Navigator <span className="text-sun">☾</span>
          </h1>
          <p className="text-[11px] text-muted">
            {data.region.name} · mission-planning panel · NASA LOLA + JPL Horizons
          </p>
        </div>
        <p className="max-w-md text-right text-[10px] leading-tight text-muted">
          Hackathon prototype. Every number is tagged Measured, Derived or Simulated. Thresholds are
          illustrative, not mission requirements.
        </p>
      </header>

      <div className="grid flex-1 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)] md:grid-rows-[minmax(0,78vh)_auto] xl:min-h-0 xl:grid-cols-[320px_minmax(0,1fr)_380px] xl:grid-rows-[minmax(0,1fr)]">
        <aside
          aria-label="Mission setup"
          className="order-2 min-h-0 min-w-0 overflow-x-hidden border-line md:order-1 md:overflow-y-auto md:border-r"
        >
          <MissionSetupPanel
            key={setupKey(setupValues)}
            values={setupValues}
            coverage={nav.coverage}
            regionExtent={geometry.extentM}
            presets={WEIGHT_PRESETS}
            targetElevationM={targetElevation}
            onApply={onApplySetup}
            onSlip={(d) =>
              dispatch({ type: "windowStart", ms: nav.window.startMs + d * 86_400_000 })
            }
          />
          <WeightsPanel
            weights={state.weights}
            presetId={state.presetId}
            onWeight={(id, value) => dispatch({ type: "weight", id, value })}
            onPreset={(id) => dispatch({ type: "preset", id })}
          />
          <SiteList
            ranking={nav.ranking}
            sites={nav.sites}
            conditions={nav.conditions}
            selectedId={state.selectedId}
            onSelect={(id) => onSelect(id)}
          />
        </aside>

        <main className="order-1 flex h-[78vh] min-h-0 flex-col md:order-2 md:h-auto">
          <div className="relative min-h-0 flex-1">
            <LunarMap
              region={data.region}
              sites={nav.sites}
              ranking={nav.ranking}
              layerId={state.layerId}
              selectedId={state.selectedId}
              onSelect={onSelect}
              onPickPoint={onPickPoint}
              gridOverlay={gridOverlay}
              roi={roi}
            />
            <div className="absolute top-2 right-2">
              <LayerToggle
                layers={layers}
                activeId={state.layerId}
                onChange={(id) => dispatch({ type: "layer", id })}
                busy={
                  isGridLayer(state.layerId) &&
                  analysis.windowPending &&
                  state.layerId !== "illumNow"
                }
              />
            </div>
            {analysis.status === "error" && (
              <div
                role="alert"
                className="absolute top-2 left-2 rounded bg-bad/20 px-2 py-1 text-xs text-bad"
              >
                Analysis unavailable: {analysis.error}
              </div>
            )}
            <div className="pointer-events-none absolute bottom-8 left-2 rounded bg-panel/85 px-2 py-1 text-[11px] text-muted">
              Click a marker, or empty ground to inspect a spot · 500 m analysis cells
            </div>
          </div>
          <TimeScrubber
            window={nav.window}
            timeMs={Math.min(nav.window.endMs, Math.max(nav.window.startMs, state.scrubMs))}
            onTime={onTime}
            sun={
              analysis.snapshot
                ? {
                    bearingDeg: analysis.snapshot.sunMapBearingDeg,
                    elevationDeg: analysis.snapshot.sunElevationDeg,
                  }
                : null
            }
            series={analysis.series?.cell === selectedCell ? (analysis.series?.sun ?? null) : null}
            pointLabel={selected?.site.name ?? null}
          />
        </main>

        <aside
          aria-label="Insights"
          className="order-3 min-h-0 min-w-0 overflow-x-hidden border-line md:col-span-2 xl:col-span-1 xl:overflow-y-auto xl:border-l"
        >
          {selected && selectedCell !== null && analysis.windowResult && (
            <CellLightSummary
              sun={analysis.windowResult.sunFraction[selectedCell]!}
              earth={analysis.windowResult.earthFraction[selectedCell]!}
              night={analysis.windowResult.longestNightHours[selectedCell]!}
              earthGap={analysis.windowResult.longestEarthGapHours[selectedCell]!}
            />
          )}
          {selected ? (
            <SiteDetail
              site={selected.site}
              ranked={selected.ranked}
              conditions={selected.conditions}
              explanation={selected.explanation}
              onRemove={
                selected.site.kind === "custom"
                  ? () => dispatch({ type: "removeCustom", id: selected.site.id })
                  : undefined
              }
            />
          ) : (
            <Intro onPick={() => nav.ranking[0] && onSelect(nav.ranking[0].siteId)} />
          )}
          {analysis.validation && <ValidationNote v={analysis.validation} />}
          <Attribution lines={data.region.attribution} />
        </aside>
      </div>
    </div>
  );
}

const setupKey = (v: SetupValues) =>
  [v.timeMs, v.windowDays, v.roiHalfKm, v.presetId, v.target?.lat, v.target?.lon].join("|");

function CellLightSummary(p: { sun: number; earth: number; night: number; earthGap: number }) {
  const h = (x: number) => (x >= 48 ? `${(x / 24).toFixed(1)} days` : `${Math.round(x)} h`);
  return (
    <section
      className="border-b border-line px-4 py-3"
      aria-label="Light and comms for this 500 m cell"
    >
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
          This 500 m cell, your window
        </h2>
        <ProvenanceBadge
          value="derived"
          title="Horizons ephemeris + LOLA terrain horizon (500 m grid)"
        />
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">☀ Sunlit</dt>
        <dd className="font-mono">{Math.round(p.sun * 100)} %</dd>
        <dt className="text-muted">Longest night</dt>
        <dd className="font-mono">{h(p.night)}</dd>
        <dt className="text-muted">🌍 Earth in view</dt>
        <dd className="font-mono">{Math.round(p.earth * 100)} %</dd>
        <dt className="text-muted">Longest Earth blackout</dt>
        <dd className="font-mono">{h(p.earthGap)}</dd>
      </dl>
    </section>
  );
}

function ValidationNote({
  v,
}: {
  v: { sunR: number; earthR: number; sunMeanAbsDiffPct: number; earthMeanAbsDiffPct: number };
}) {
  return (
    <p className="border-b border-line px-4 py-2 text-[10px] leading-snug text-muted">
      Grid check: our 14-month Sun/Earth visibility vs NASA&apos;s independent 18.6-year maps
      correlate at r = {v.sunR} (Sun) and r = {v.earthR} (Earth); mean differences{" "}
      {v.sunMeanAbsDiffPct} and {v.earthMeanAbsDiffPct} points.
    </p>
  );
}

function Intro({ onPick }: { onPick: () => void }) {
  return (
    <section className="space-y-3 px-4 py-4 text-sm">
      <h2 className="text-lg font-semibold">Where (and when) should we land?</h2>
      <p className="text-muted">
        At the lunar south pole the Sun and Earth hug the horizon. A ridge a few kilometres away can
        mean weeks of darkness or no radio link. The map shows sunlight for <em>your</em> dates,
        computed against the real LOLA terrain.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-muted">
        <li>Set the landing time and mission window on the left.</li>
        <li>Press ▶ below the map to watch light and shadow move.</li>
        <li>Click any spot to see how much sunlight and Earth contact it gets.</li>
      </ol>
      <button
        onClick={onPick}
        className="rounded border border-sun/60 px-3 py-1 text-sun hover:bg-sun/10 focus-visible:outline-2 focus-visible:outline-sun"
      >
        Show the top-ranked site →
      </button>
    </section>
  );
}

function Attribution({ lines }: { lines: string[] }) {
  return (
    <footer className="space-y-1 px-4 py-3 text-[10px] leading-snug text-muted">
      <div className="font-semibold tracking-[0.12em] uppercase">Data</div>
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </footer>
  );
}
