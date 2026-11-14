/** Message types between the UI thread and analysis.worker.ts. Plain data only (structured-clone safe). */
import type { GridValidation } from "@/domain/grid/grid";
import type { PointSeries } from "@/domain/illumination/illumination";
import type { Body, TimeWindow } from "@/domain/types";

export type AnalysisRequest =
  | { type: "window"; id: number; window: TimeWindow; stepHours: number }
  | { type: "snapshot"; id: number; tMs: number }
  | { type: "series"; id: number; cell: number; window: TimeWindow; stepHours: number };

export interface WindowResult {
  type: "window";
  id: number;
  window: TimeWindow;
  /** True for the quick coarse preview; a full-resolution result follows. */
  partial: boolean;
  /** Per cell (grid order), 0..1. */
  sunFraction: Float32Array;
  earthFraction: Float32Array;
  /** Per cell, hours. */
  longestNightHours: Float32Array;
  longestEarthGapHours: Float32Array;
  computeMs: number;
}

export interface SnapshotResult {
  type: "snapshot";
  id: number;
  tMs: number;
  /** Visible solar disc fraction per cell. */
  sun: Float32Array;
  /**
   * Direction the sunlight comes from ON THE MAP, clockwise from map-up (+y). In polar stereographic
   * coordinates this is simply the sub-solar longitude.
   */
  sunMapBearingDeg: number;
  /** Sun elevation above the smooth-sphere horizon at the region centre. */
  sunElevationDeg: number;
}

export interface SeriesResult {
  type: "series";
  id: number;
  cell: number;
  sun: PointSeries;
  earth: PointSeries;
}

export type AnalysisResponse =
  | { type: "ready"; validation?: GridValidation; cells: number }
  | { type: "error"; id?: number; message: string }
  | WindowResult
  | SnapshotResult
  | SeriesResult;

export type BodySeries = Record<Body, PointSeries>;
