"use client";

import { useEffect, useState } from "react";
import { getDataProvider, type RegionMeta } from "@/data";
import type { AnalysisGrid } from "@/domain/grid/grid";
import type { EphemerisSeries, Site } from "@/domain/types";

export interface Dataset {
  region: RegionMeta;
  sites: Site[];
  ephemeris: EphemerisSeries;
  /** Per-cell analysis grid (also loaded independently by the analysis worker). */
  grid: AnalysisGrid;
}

export type DatasetState =
  { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: Dataset };

/** Loads everything the app needs once, through the swappable data provider. */
export function useDataset(): DatasetState {
  const [state, setState] = useState<DatasetState>({ status: "loading" });
  useEffect(() => {
    const provider = getDataProvider();
    let alive = true;
    Promise.all([
      provider.getRegion(),
      provider.getSites(),
      provider.getEphemeris(),
      provider.getAnalysisGrid(),
    ])
      .then(([region, sites, ephemeris, grid]) => {
        if (alive) setState({ status: "ready", data: { region, sites, ephemeris, grid } });
      })
      .catch((e: unknown) => {
        if (alive)
          setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
