"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { xyToLonLat } from "@/domain/geo/polarStereo";
import type { LonLat } from "@/domain/types";
import { LayerToggle } from "./map/LayerToggle";
import { ScenarioPanel } from "./scenario/ScenarioPanel";
import { useDataset, type Dataset } from "./scenario/useDataset";
import { useNavigator } from "./scenario/useNavigator";
import { CustomSiteForm } from "./sites/CustomSiteForm";
import { SiteDetail } from "./sites/SiteDetail";
import { SiteList } from "./sites/SiteList";
import { WeightsPanel } from "./weights/WeightsPanel";

// OpenLayers touches `window`: render the map on the client only.
const LunarMap = dynamic(() => import("./map/LunarMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-sm text-muted">Loading map…</div>
  ),
});

export function NavigatorApp() {
  const ds = useDataset();
  if (ds.status === "loading")
    return (
      <div className="grid flex-1 place-items-center text-sm text-muted">Loading lunar data…</div>
    );
  if (ds.status === "error")
    return (
      <div className="grid flex-1 place-items-center text-sm text-bad">
        Could not load data: {ds.message}
      </div>
    );
  return <Navigator data={ds.data} />;
}

function Navigator({ data }: { data: Dataset }) {
  const nav = useNavigator(data);
  const { state, dispatch, selected } = nav;

  const addCustom = useCallback(
    (p: LonLat) => dispatch({ type: "addCustom", site: nav.makeCustomSite(p) }),
    [dispatch, nav],
  );
  const onSelect = useCallback((id: string | null) => dispatch({ type: "select", id }), [dispatch]);
  const onPickPoint = useCallback(
    (x: number, y: number) => addCustom(xyToLonLat(x, y)),
    [addCustom],
  );

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            Lunar Landing Site Navigator <span className="text-sun">☾</span>
          </h1>
          <p className="text-[11px] text-muted">
            {data.region.name} · Sun &amp; Earth vs. the real terrain horizon · NASA LOLA + JPL
            Horizons
          </p>
        </div>
        <p className="max-w-md text-right text-[10px] leading-tight text-muted">
          Hackathon prototype. Scores use illustrative thresholds, not mission requirements.
        </p>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[330px_minmax(0,1fr)_400px]">
        <aside className="order-2 min-w-0 overflow-x-hidden border-line lg:order-1 lg:overflow-y-auto lg:border-r">
          <ScenarioPanel
            window={nav.window}
            windowDays={state.windowDays}
            coverage={nav.coverage}
            onStart={(ms) => dispatch({ type: "windowStart", ms })}
            onDays={(days) => dispatch({ type: "windowDays", days })}
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
          <CustomSiteForm onAdd={addCustom} />
        </aside>

        <main className="relative order-1 h-[58vh] lg:order-2 lg:h-auto">
          <LunarMap
            region={data.region}
            sites={nav.sites}
            ranking={nav.ranking}
            layerId={state.layerId}
            selectedId={state.selectedId}
            onSelect={onSelect}
            onPickPoint={onPickPoint}
          />
          <div className="absolute top-2 right-2">
            <LayerToggle
              layers={data.region.layers}
              activeId={state.layerId}
              onChange={(id) => dispatch({ type: "layer", id })}
            />
          </div>
          <div className="pointer-events-none absolute bottom-8 left-2 rounded bg-panel/80 px-2 py-1 text-[10px] text-muted">
            Polar stereographic · 100 × 100 km around the south pole · click a marker, or empty
            ground to test a spot
          </div>
        </main>

        <aside className="order-3 min-w-0 overflow-x-hidden border-line lg:overflow-y-auto lg:border-l">
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
          <Attribution lines={data.region.attribution} />
        </aside>
      </div>
    </div>
  );
}

function Intro({ onPick }: { onPick: () => void }) {
  return (
    <section className="space-y-3 px-4 py-4 text-sm">
      <h2 className="text-lg font-semibold">Where (and when) should we land?</h2>
      <p className="text-muted">
        At the lunar south pole the Sun and Earth hug the horizon. A ridge a few kilometres away can
        mean weeks of darkness or no radio link. This tool checks each site against the{" "}
        <em>real</em> LOLA terrain horizon for your landing date.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-muted">
        <li>Pick a landing date and mission window.</li>
        <li>Set what matters (power, comms, safety, ice).</li>
        <li>Click a site to see why it ranks where it does.</li>
      </ol>
      <button
        onClick={onPick}
        className="rounded border border-sun/60 px-3 py-1 text-sun hover:bg-sun/10"
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
