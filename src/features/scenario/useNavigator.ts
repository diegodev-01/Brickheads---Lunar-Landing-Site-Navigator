"use client";

import { useMemo, useReducer } from "react";
import { lonLatToXY } from "@/domain/geo/polarStereo";
import {
  DEFAULT_WEIGHTS,
  WEIGHT_PRESETS,
  type FactorId,
  type Weights,
} from "@/domain/scoring/config";
import { explain, type Explanation } from "@/domain/scoring/explain";
import { rankSites, type RankedSite } from "@/domain/scoring/score";
import type { LonLat, Site, SiteConditions } from "@/domain/types";
import { computeConditions, ephemerisCoverage } from "@/domain/visibility/windows";
import type { Dataset } from "./useDataset";

const DAY_MS = 86_400_000;
export const LUNAR_DAY_DAYS = 29.53;

export interface NavigatorState {
  weights: Weights;
  presetId: string | null;
  windowStartMs: number;
  windowDays: number;
  selectedId: string | null;
  layerId: string;
  customSites: Site[];
}

type Action =
  | { type: "weight"; id: FactorId; value: number }
  | { type: "preset"; id: string }
  | { type: "windowStart"; ms: number }
  | { type: "windowDays"; days: number }
  | { type: "select"; id: string | null }
  | { type: "layer"; id: string }
  | { type: "addCustom"; site: Site }
  | { type: "removeCustom"; id: string };

function reducer(s: NavigatorState, a: Action): NavigatorState {
  switch (a.type) {
    case "weight":
      return { ...s, weights: { ...s.weights, [a.id]: a.value }, presetId: null };
    case "preset": {
      const p = WEIGHT_PRESETS.find((x) => x.id === a.id);
      return p ? { ...s, weights: { ...p.weights }, presetId: p.id } : s;
    }
    case "windowStart":
      return { ...s, windowStartMs: a.ms };
    case "windowDays":
      return { ...s, windowDays: a.days };
    case "select":
      return { ...s, selectedId: a.id };
    case "layer":
      return { ...s, layerId: a.id };
    case "addCustom":
      return { ...s, customSites: [...s.customSites, a.site], selectedId: a.site.id };
    case "removeCustom":
      return {
        ...s,
        customSites: s.customSites.filter((c) => c.id !== a.id),
        selectedId: s.selectedId === a.id ? null : s.selectedId,
      };
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

export interface NavigatorView {
  state: NavigatorState;
  dispatch: React.Dispatch<Action>;
  sites: Site[];
  window: { startMs: number; endMs: number };
  coverage: { startMs: number; endMs: number };
  conditions: Map<string, SiteConditions>;
  ranking: RankedSite[];
  selected: {
    site: Site;
    ranked: RankedSite;
    conditions: SiteConditions;
    explanation: Explanation;
  } | null;
  makeCustomSite: (p: LonLat, label?: string) => Site;
}

export function useNavigator(data: Dataset): NavigatorView {
  const coverage = useMemo(() => ephemerisCoverage(data.ephemeris), [data.ephemeris]);
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    weights: { ...DEFAULT_WEIGHTS },
    presetId: WEIGHT_PRESETS[0]!.id,
    windowStartMs: defaultStart(coverage),
    windowDays: LUNAR_DAY_DAYS,
    selectedId: null,
    layerId: "sun",
    customSites: [],
  }));

  const sites = useMemo(
    () => [...data.sites, ...state.customSites],
    [data.sites, state.customSites],
  );
  const win = useMemo(
    () => clampWindow(state.windowStartMs, state.windowDays, coverage),
    [state.windowStartMs, state.windowDays, coverage],
  );

  // The expensive part (~30k trig evaluations): only re-runs when sites or the window change.
  const conditions = useMemo(
    () => new Map(sites.map((s) => [s.id, computeConditions(s, data.ephemeris, win)])),
    [sites, data.ephemeris, win],
  );

  // Cheap: re-runs on every weight change, so the ranking updates live.
  const ranking = useMemo(
    () => rankSites(sites, conditions, state.weights, state.windowDays),
    [sites, conditions, state.weights, state.windowDays],
  );

  const selected = useMemo(() => {
    const site = sites.find((s) => s.id === state.selectedId);
    const ranked = ranking.find((r) => r.siteId === state.selectedId);
    const cond = state.selectedId ? conditions.get(state.selectedId) : undefined;
    if (!site || !ranked || !cond) return null;
    return { site, ranked, conditions: cond, explanation: explain(ranked, ranking.length) };
  }, [sites, ranking, conditions, state.selectedId]);

  const makeCustomSite = (p: LonLat, label?: string): Site => {
    const { x, y } = lonLatToXY(p);
    const n = Math.max(0, ...state.customSites.map((c) => Number(c.id.slice(1)) || 0)) + 1;
    return {
      id: `C${n}`,
      name: label ?? `Custom ${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°E`,
      kind: "custom",
      lat: p.lat,
      lon: p.lon,
      x,
      y,
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
    ranking,
    selected,
    makeCustomSite,
  };
}
