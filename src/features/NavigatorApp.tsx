"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo } from "react";
import { ProvenanceBadge } from "@/components/ui/Panel";
import { cellCenter, cellIndexAt, type Extent } from "@/domain/grid/grid";
import { xyToLonLat } from "@/domain/geo/polarStereo";
import type { MissionSetup } from "@/domain/mission/setup";
import { readinessOf } from "@/domain/scoring/explainCell";
import type { Zone } from "@/domain/scoring/grid";
import { SCORING_PRESETS } from "@/domain/scoring/model";
import { createSensorLayers } from "@/domain/sensors/sensors";
import type { LonLat } from "@/domain/types";
import { useAnalysis } from "./analysis/useAnalysis";
import { CommsTimeline } from "./comms/CommsTimeline";
import { SensorReadings } from "./insights/SensorReadings";
import { paintGrid, paintSuitability, paletteLut } from "./map/heatmap";
import {
  GRID_LAYERS,
  isGridLayer,
  sensorEntries,
  sensorStyle,
  staticEntries,
} from "./map/layerCatalog";
import { LayerToggle } from "./map/LayerToggle";
import { ReadinessCard } from "./recommend/ReadinessCard";
import { useRecommendation } from "./recommend/useRecommendation";
import { ZONE_LETTERS, ZoneCards } from "./recommend/ZoneCards";
import { useDataset, type Dataset } from "./scenario/useDataset";
import { useNavigator, type Mode } from "./scenario/useNavigator";
import { MissionSetupPanel, type SetupValues } from "./setup/MissionSetupPanel";
import { SiteDetail } from "./sites/SiteDetail";
import { SiteList, type SiteScore } from "./sites/SiteList";
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

const MODES: { id: Mode; label: string; hint: string }[] = [
  {
    id: "explore",
    label: "Explore",
    hint: "Browse the map layers: light, comms, terrain, instruments.",
  },
  {
    id: "recommend",
    label: "Recommend",
    hint: "The 3 best landing zones for your dates and priorities.",
  },
  { id: "analyze", label: "Analyze", hint: "Click any point to see why it is good or bad." },
];

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

  const sensorLayers = useMemo(
    () => createSensorLayers(data.grid, data.sensors),
    [data.grid, data.sensors],
  );
  const activeSensor = sensorLayers.find((l) => l.id === state.layerId) ?? null;
  const sunNow = analysis.snapshot?.sun;

  // Region of interest: a square around the selected point (whole region when nothing is selected).
  const roi: Extent | null = useMemo(() => {
    if (!selected) return null;
    const h = state.roiHalfKm * 1000;
    const [x0, y0, x1, y1] = geometry.extentM;
    const { x, y } = selected.site;
    return [Math.max(x0, x - h), Math.max(y0, y - h), Math.min(x1, x + h), Math.min(y1, y + h)];
  }, [selected, state.roiHalfKm, geometry]);

  // In Recommend mode the search area is fixed by the target, not by inspecting zones.
  const rec = useRecommendation(
    data,
    sensorLayers,
    analysis.windowResult,
    state.weights,
    state.model,
    roi,
  );

  // Heatmap canvas for the active computed layer (suitability, illumination or sensor).
  const gridOverlay = useMemo(() => {
    const canvas = () => document.createElement("canvas");
    if (activeSensor) {
      const st = sensorStyle(activeSensor.id);
      if (!st) return null;
      const r = activeSensor.getLayer(undefined, state.scrubMs, { sunNow });
      const c = paintGrid(canvas(), geometry, r.grid, st.min, st.max, paletteLut(st.palette));
      return { canvas: c, extent: geometry.extentM, version: 0 };
    }
    if (!isGridLayer(state.layerId)) return null;
    if (state.layerId === "suitability") {
      if (!rec.scores) return null;
      const c = paintSuitability(canvas(), geometry, rec.scores.score, rec.scores.failed);
      return { canvas: c, extent: geometry.extentM, version: 0 };
    }
    const values =
      state.layerId === "illumNow"
        ? analysis.snapshot?.sun
        : state.layerId === "earthWindow"
          ? analysis.windowResult?.earthFraction
          : state.layerId === "relayWindow"
            ? analysis.windowResult?.relayFraction
            : analysis.windowResult?.sunFraction;
    if (!values) return null;
    const c = paintGrid(canvas(), geometry, values, 0, 1, LUTS[state.layerId]!);
    return { canvas: c, extent: geometry.extentM, version: 0 };
  }, [
    state.layerId,
    state.scrubMs,
    sunNow,
    activeSensor,
    rec.scores,
    analysis.snapshot,
    analysis.windowResult,
    geometry,
  ]);

  const layers = useMemo(
    () => [...GRID_LAYERS, ...sensorEntries(sensorLayers), ...staticEntries(data.region.layers)],
    [data.region.layers, sensorLayers],
  );

  // Every named site is scored with the same cell model.
  const siteScores = useMemo(() => {
    const m = new Map<string, SiteScore>();
    for (const s of nav.sites) {
      const cell = cellIndexAt(geometry, s.x, s.y);
      const e = cell === null ? null : rec.evaluate(cell);
      m.set(s.id, {
        score: e?.passed ? e.score : null,
        readiness: e ? readinessOf(e) : null,
      });
    }
    return m;
  }, [nav.sites, geometry, rec]);

  const mapZones = useMemo(
    () =>
      state.mode === "explore"
        ? []
        : rec.zones.map((z, i) => ({
            letter: ZONE_LETTERS[i]!,
            x: z.x,
            y: z.y,
            cells: z.cells.map((c) => {
              const { x, y } = cellCenter(geometry, c);
              const h = geometry.cellSizeM / 2;
              return [x - h, y - h, x + h, y + h] as Extent;
            }),
          })),
    [state.mode, rec.zones, geometry],
  );

  const onInspectZone = useCallback(
    (z: Zone) => {
      const i = rec.zones.indexOf(z);
      const site = nav.makeCustomSite(xyToLonLat(z.x, z.y), `Zone ${ZONE_LETTERS[i] ?? ""}`.trim());
      dispatch({ type: "addCustom", site });
      dispatch({ type: "mode", mode: "analyze" });
    },
    [rec.zones, nav, dispatch],
  );

  const setupValues: SetupValues = useMemo(
    () => ({
      timeMs: nav.window.startMs,
      windowDays: state.windowDays,
      roiHalfKm: state.roiHalfKm,
      presetId: state.presetId ?? SCORING_PRESETS[0]!.id,
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
  const selectedReadiness =
    selected && selectedCell !== null ? rec.explain(selectedCell, selected.site.name) : null;
  const excludedShare = rec.scores
    ? 1 - rec.scores.passed / Math.max(1, rec.scores.evaluated)
    : null;

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
        <div role="tablist" aria-label="Mode" className="flex rounded-md border border-line p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              type="button"
              aria-selected={state.mode === m.id}
              title={m.hint}
              onClick={() => dispatch({ type: "mode", mode: m.id })}
              className={`rounded px-3 py-1 text-sm transition focus-visible:outline-2 focus-visible:outline-sun ${
                state.mode === m.id
                  ? "bg-sun font-semibold text-background"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="max-w-sm text-right text-[10px] leading-tight text-muted">
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
            presets={SCORING_PRESETS}
            targetElevationM={targetElevation}
            onApply={onApplySetup}
            onSlip={(d) =>
              dispatch({ type: "windowStart", ms: nav.window.startMs + d * 86_400_000 })
            }
          />
          <WeightsPanel
            weights={state.weights}
            presetId={state.presetId}
            model={state.model}
            excludedShare={excludedShare}
            onWeight={(id, value) => dispatch({ type: "weight", id, value })}
            onPreset={(id) => dispatch({ type: "preset", id })}
            onModel={(model) => dispatch({ type: "model", model })}
          />
          <SiteList
            sites={nav.sites}
            scores={siteScores}
            selectedId={state.selectedId}
            onSelect={(id) => onSelect(id)}
          />
        </aside>

        <main className="order-1 flex h-[78vh] min-h-0 flex-col md:order-2 md:h-auto">
          <div className="relative min-h-0 flex-1">
            <LunarMap
              region={data.region}
              sites={nav.sites}
              siteScores={siteScores}
              zones={mapZones}
              layerId={state.layerId}
              selectedId={state.selectedId}
              onSelect={onSelect}
              onPickPoint={onPickPoint}
              gridOverlay={gridOverlay}
              roi={roi}
            />
            <div className="absolute top-2 right-2 bottom-2 flex flex-col items-end">
              <LayerToggle
                layers={layers}
                activeId={state.layerId}
                onChange={(id) => dispatch({ type: "layer", id })}
                busy={
                  (isGridLayer(state.layerId) &&
                    analysis.windowPending &&
                    state.layerId !== "illumNow") ||
                  (state.layerId === "suitability" && rec.provisional)
                }
              />
            </div>
            {analysis.status === "error" && (
              <div
                role="alert"
                className="absolute top-2 left-12 rounded bg-bad/20 px-2 py-1 text-xs text-bad"
              >
                Analysis unavailable: {analysis.error}
              </div>
            )}
            <div className="pointer-events-none absolute bottom-8 left-2 rounded bg-panel/85 px-2 py-1 text-[11px] text-muted">
              {MODES.find((m) => m.id === state.mode)!.hint} · 500 m cells
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
          {state.mode === "recommend" ? (
            <ZoneCards
              rec={rec}
              cellSizeM={geometry.cellSizeM}
              onInspect={onInspectZone}
              hasRoi={roi !== null}
            />
          ) : selected ? (
            <>
              <SiteDetail
                site={selected.site}
                conditions={selected.conditions}
                readiness={
                  selectedReadiness ? (
                    <ReadinessCard
                      evaluation={selectedReadiness.evaluation}
                      explanation={selectedReadiness.explanation}
                    />
                  ) : (
                    <p className="px-4 py-2 text-sm text-muted" role="status">
                      Computing readiness for your dates…
                    </p>
                  )
                }
                onRemove={
                  selected.site.kind === "custom"
                    ? () => dispatch({ type: "removeCustom", id: selected.site.id })
                    : undefined
                }
              />
              {selectedCell !== null && analysis.windowResult && (
                <CellLightSummary
                  sun={analysis.windowResult.sunFraction[selectedCell]!}
                  earth={analysis.windowResult.earthFraction[selectedCell]!}
                  night={analysis.windowResult.longestNightHours[selectedCell]!}
                  earthGap={analysis.windowResult.longestEarthGapHours[selectedCell]!}
                />
              )}
              {analysis.series && analysis.series.cell === selectedCell && (
                <CommsTimeline
                  window={nav.window}
                  relay={analysis.series.relay}
                  earth={analysis.series.earth}
                  timeMs={state.scrubMs}
                />
              )}
              {selectedCell !== null && (
                <SensorReadings
                  layers={sensorLayers}
                  cell={selectedCell}
                  timeMs={state.scrubMs}
                  ctx={{ sunNow }}
                />
              )}
            </>
          ) : (
            <Intro
              mode={state.mode}
              onRecommend={() => dispatch({ type: "mode", mode: "recommend" })}
            />
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

function Intro({ mode, onRecommend }: { mode: Mode; onRecommend: () => void }) {
  return (
    <section className="space-y-3 px-4 py-4 text-sm">
      <h2 className="text-lg font-semibold">Where (and when) should we land?</h2>
      <p className="text-muted">
        At the lunar south pole the Sun and Earth hug the horizon. A ridge a few kilometres away can
        mean weeks of darkness or no radio link. Everything here is computed for <em>your</em> dates
        against the real LOLA terrain.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-muted">
        <li>Set the landing time and mission window on the left.</li>
        <li>Press ▶ below the map to watch light and shadow move.</li>
        <li>
          {mode === "analyze"
            ? "Click any point on the map to see why it is good or bad."
            : "Get the 3 best landing zones, with plain-language reasons."}
        </li>
      </ol>
      <button
        type="button"
        onClick={onRecommend}
        className="rounded border border-sun/60 px-3 py-1 text-sun hover:bg-sun/10 focus-visible:outline-2 focus-visible:outline-sun"
      >
        Show the top 3 landing zones →
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
