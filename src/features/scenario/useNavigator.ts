"use client";

import { useMemo, useReducer } from "react";
import { lonLatToXY } from "@/domain/geo/polarStereo";
import { cellHorizonProfile, cellIndexAt } from "@/domain/grid/grid";
import {
  DEFAULT_PRESET_ID,
  defaultModelConfig,
  presetWeights,
  setWeight,
  type Factor,
  type FactorWeights,
  type ScoringModelConfig,
} from "@/domain/scoring/model";
import type { LonLat, Site, SiteConditions } from "@/domain/types";
import { computeConditions, ephemerisCoverage } from "@/domain/visibility/windows";
import type { Dataset } from "./useDataset";

const DAY_MS = 86_400_000;
export const LUNAR_DAY_DAYS = 29.53;

export type Mode = "explore" | "recommend" | "analyze";

export interface NavigatorState {
  mode: Mode;
  weights: FactorWeights;
  /** null once the user edits a weight by hand. */
  presetId: string | null;
  model: ScoringModelConfig;
  /** Landing time = start of the analysis window (UTC ms). */
  windowStartMs: number;
  windowDays: number;
  /** Time shown by the scrubber, inside the window. */
  scrubMs: number;
  /** Half-width of the region of interest around the target, km. */
  roiHalfKm: number;
  selectedId: string | null;
  layerId: string;
  customSites: Site[];
}

export type Action =
  | { type: "mode"; mode: Mode }
  | { type: "weight"; id: Factor; value: number }
  | { type: "preset"; id: string }
  | { type: "model"; model: ScoringModelConfig }
  | { type: "windowStart"; ms: number }
  | { type: "scrub"; ms: number }
  | {
      type: "applySetup";
      startMs: number;
      days: number;
      roiHalfKm: number;
      presetId: string;
      /** A new custom site to add and select (target typed by the user), if any. */
      site?: Site;
    }
  | { type: "windowDays"; days: number }
  | { type: "select"; id: string | null }
  | { type: "layer"; id: string }
  | { type: "addCustom"; site: Site }
  /** Move the single "aimed" landing point (replaces the previous one instead of piling up). */
  | { type: "aim"; site: Site }
  | { type: "removeCustom"; id: string }
  | { type: "loadScenario"; state: Partial<NavigatorState> };

/** Layer each mode switches to when entered. */
const MODE_LAYER: Record<Mode, string | null> = {
  explore: null,
  recommend: "suitability",
  analyze: "suitability",
};

export function reducer(s: NavigatorState, a: Action): NavigatorState {
  switch (a.type) {
    case "mode":
      return { ...s, mode: a.mode, layerId: MODE_LAYER[a.mode] ?? s.layerId };
    case "weight":
      return { ...s, weights: setWeight(s.weights, a.id, a.value), presetId: null };
    case "preset":
      return { ...s, weights: presetWeights(a.id), presetId: a.id };
    case "model":
      return { ...s, model: a.model };
    case "windowStart":
      return { ...s, windowStartMs: a.ms, scrubMs: a.ms };
    case "windowDays":
      return { ...s, windowDays: a.days, scrubMs: s.windowStartMs };
    case "scrub":
      return { ...s, scrubMs: a.ms };
    case "applySetup":
      return {
        ...s,
        windowStartMs: a.startMs,
        scrubMs: a.startMs,
        windowDays: a.days,
        roiHalfKm: a.roiHalfKm,
        weights: presetWeights(a.presetId),
        presetId: a.presetId,
        ...(a.site ? { customSites: [...s.customSites, a.site], selectedId: a.site.id } : {}),
      };
    case "select":
      return { ...s, selectedId: a.id };
    case "layer":
      return { ...s, layerId: a.id };
    case "addCustom":
      return { ...s, customSites: [...s.customSites, a.site], selectedId: a.site.id };
    case "aim":
      return {
        ...s,
        customSites: [...s.customSites.filter((c) => c.id !== a.site.id), a.site],
        selectedId: a.site.id,
      };
    case "removeCustom":
      return {
        ...s,
        customSites: s.customSites.filter((c) => c.id !== a.id),
        selectedId: s.selectedId === a.id ? null : s.selectedId,
      };
    case "loadScenario":
      return { ...s, ...a.state };
  }
}

/** Clamp a window into the bundled ephemeris coverage. */
function clampWindow(startMs: number, days: number, cov: { startMs: number; endMs: number }) {
  const len = days * DAY_MS;
  const start = Math.min(Math.max(startMs, cov.startMs), cov.endMs - len);
  return { startMs: start, endMs: start + len };
}

function defaultStart(cov: { startMs: number; endMs: number }): number {
  const d = new Date();
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return today >= cov.startMs && today < cov.endMs - LUNAR_DAY_DAYS * DAY_MS ? today : cov.startMs;
}

export function initialState(coverageStartMs: number, start: number): NavigatorState {
  return {
    mode: "explore",
    weights: presetWeights(DEFAULT_PRESET_ID),
    presetId: DEFAULT_PRESET_ID,
    model: defaultModelConfig(),
    windowStartMs: Math.max(start, coverageStartMs),
    scrubMs: Math.max(start, coverageStartMs),
    windowDays: 14,
    roiHalfKm: 10,
    selectedId: null,
    layerId: "illumWindow",
    customSites: [],
  };
}

export interface NavigatorView {
  state: NavigatorState;
  dispatch: React.Dispatch<Action>;
  sites: Site[];
  window: { startMs: number; endMs: number };
  coverage: { startMs: number; endMs: number };
  conditions: Map<string, SiteConditions>;
  selected: { site: Site; conditions: SiteConditions } | null;
  makeCustomSite: (p: LonLat, label?: string) => Site;
}

export function useNavigator(data: Dataset, initial: Partial<NavigatorState> = {}): NavigatorView {
  const coverage = useMemo(() => ephemerisCoverage(data.ephemeris), [data.ephemeris]);
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    ...initialState(coverage.startMs, defaultStart(coverage)),
    ...initial,
  }));

  const sites = useMemo(
    () => [...data.sites, ...state.customSites],
    [data.sites, state.customSites],
  );
  const win = useMemo(
    () => clampWindow(state.windowStartMs, state.windowDays, coverage),
    [state.windowStartMs, state.windowDays, coverage],
  );

  // Fine-grained (720-bin) Sun/Earth tracks for the site panels; only for the selected site.
  const selectedSite = sites.find((s) => s.id === state.selectedId) ?? null;
  const conditions = useMemo(() => {
    const m = new Map<string, SiteConditions>();
    if (selectedSite) m.set(selectedSite.id, computeConditions(selectedSite, data.ephemeris, win));
    return m;
  }, [selectedSite, data.ephemeris, win]);

  const selected = useMemo(() => {
    if (!selectedSite) return null;
    const cond = conditions.get(selectedSite.id);
    return cond ? { site: selectedSite, conditions: cond } : null;
  }, [selectedSite, conditions]);

  const makeCustomSite = (p: LonLat, label?: string): Site => {
    const { x, y } = lonLatToXY(p);
    const n = Math.max(0, ...state.customSites.map((c) => Number(c.id.slice(1)) || 0)) + 1;
    // Inside the grid, a custom point inherits its 500 m cell's ray-cast terrain horizon.
    const cell = cellIndexAt(data.grid.geometry, x, y);
    const h = data.grid.horizon;
    return {
      id: `C${n}`,
      name: label ?? `Point ${p.lat.toFixed(3)}°, ${p.lon.toFixed(2)}°E`,
      kind: "custom",
      lat: p.lat,
      lon: p.lon,
      x,
      y,
      elevationM: cell === null ? undefined : data.grid.fields.elevation.data[cell],
      horizon:
        cell === null
          ? undefined
          : { startAzDeg: 0, stepDeg: h.binDeg, elevationDeg: cellHorizonProfile(h, cell) },
      provenance: "derived",
    };
  };

  return {
    state,
    dispatch,
    sites,
    window: win,
    coverage,
    conditions,
    selected,
    makeCustomSite,
  };
}
