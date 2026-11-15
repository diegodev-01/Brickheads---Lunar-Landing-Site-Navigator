"use client";

/**
 * Glue between the analysis results and the pure scoring engine. Scoring the whole grid takes
 * ~75 ms, so it runs on a deferred copy of the weights/config: sliders stay responsive while the
 * heatmap and top-3 catch up.
 */
import { useCallback, useDeferredValue, useMemo } from "react";
import { cellsInExtent, type Extent } from "@/domain/grid/grid";
import type { CellEvaluation } from "@/domain/scoring/evaluate";
import { explainCell, type CellExplanation } from "@/domain/scoring/explainCell";
import {
  evaluateAt,
  inputConfidence,
  neighbourhoodMax,
  scoreGrid,
  selectZones,
  type GridScores,
  type ScoringContext,
  type Zone,
} from "@/domain/scoring/grid";
import type { FactorWeights, ScoringModelConfig } from "@/domain/scoring/model";
import type { SensorLayer } from "@/domain/sensors/sensors";
import type { WindowResult } from "@/workers/analysisProtocol";
import type { Dataset } from "../scenario/useDataset";

export interface Recommendation {
  ready: boolean;
  /** True while showing results for the coarse preview or stale weights. */
  provisional: boolean;
  scores: GridScores | null;
  zones: Zone[];
  /** Cells considered for the top-3 (the ROI, or the whole region). */
  roiCells: Int32Array;
  evaluate: (cell: number) => CellEvaluation | null;
  explain: (
    cell: number,
    name?: string,
  ) => { evaluation: CellEvaluation; explanation: CellExplanation } | null;
}

/** Inputs that are SIMULATED in the current dataset (named in explanations). */
const SIMULATED_INPUTS = ["Boulder hazard"];

export function useRecommendation(
  data: Dataset,
  sensorLayers: SensorLayer[],
  windowResult: WindowResult | null,
  weights: FactorWeights,
  model: ScoringModelConfig,
  roi: Extent | null,
): Recommendation {
  const geometry = data.grid.geometry;

  const iceNearby = useMemo(() => {
    const ice = sensorLayers.find((l) => l.id === "derived.ice");
    const values = ice?.getLayer().grid ?? new Float32Array(geometry.cols * geometry.rows);
    return neighbourhoodMax(geometry, values, model.iceNeighbourhoodKm);
  }, [sensorLayers, geometry, model.iceNeighbourhoodKm]);

  const confidence = useMemo(
    () => inputConfidence(data.grid, data.sensors),
    [data.grid, data.sensors],
  );

  const ctx: ScoringContext | null = useMemo(
    () =>
      windowResult
        ? {
            grid: data.grid,
            iceNearby,
            confidence,
            window: {
              sunFraction: windowResult.sunFraction,
              longestNightH: windowResult.longestNightHours,
              dteFraction: windowResult.earthFraction,
              dteGapH: windowResult.longestEarthGapHours,
              relayFraction: windowResult.relayFraction,
              relayGapH: windowResult.relayGapHours,
            },
          }
        : null,
    [windowResult, data.grid, iceNearby, confidence],
  );

  const dWeights = useDeferredValue(weights);
  const dModel = useDeferredValue(model);
  const all = useMemo(() => cellsInExtent(geometry), [geometry]);
  const roiCells = useMemo(() => (roi ? cellsInExtent(geometry, roi) : all), [geometry, roi, all]);

  const scores = useMemo(
    () => (ctx ? scoreGrid(ctx, all, dModel, dWeights) : null),
    [ctx, all, dModel, dWeights],
  );
  const zones = useMemo(
    () => (scores ? selectZones(geometry, scores, roiCells) : []),
    [scores, geometry, roiCells],
  );

  const evaluate = useCallback(
    (cell: number) => (ctx ? evaluateAt(ctx, cell, model, weights) : null),
    [ctx, model, weights],
  );
  const explain = useCallback(
    (cell: number, name?: string) => {
      const evaluation = evaluate(cell);
      if (!evaluation) return null;
      const viaRelay = evaluation.factors.find((f) => f.id === "comms")?.raw.viaRelay === 1;
      const simulatedInputs = viaRelay ? [...SIMULATED_INPUTS, "Relay orbit"] : SIMULATED_INPUTS;
      return { evaluation, explanation: explainCell(evaluation, name, { simulatedInputs }) };
    },
    [evaluate],
  );

  return {
    ready: scores !== null,
    provisional: Boolean(windowResult?.partial) || dWeights !== weights || dModel !== model,
    scores,
    zones,
    roiCells,
    evaluate,
    explain,
  };
}
