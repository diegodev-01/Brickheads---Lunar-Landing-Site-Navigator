/**
 * Scoring over the whole analysis grid, neighbourhood helpers and top-3 zone selection (NMS).
 */
import { cellCenter, type AnalysisGrid, type GridGeometry } from "../grid/grid";
import type { Confidence, ProvenanceTag } from "../provenance";
import { boulderIndex, type SensorFields } from "../sensors/sensors";
import {
  evaluateCell,
  type CellEvaluation,
  type CellInputs,
  type GateId,
  type InputConfidence,
} from "./evaluate";
import type { FactorWeights, ScoringModelConfig } from "./model";

/** Per-cell arrays from the illumination (and later relay) computation for the current window. */
export interface WindowArrays {
  sunFraction: Float32Array;
  longestNightH: Float32Array;
  dteFraction: Float32Array;
  dteGapH: Float32Array;
  relayFraction?: Float32Array;
  relayGapH?: Float32Array;
}

export interface ScoringContext {
  grid: AnalysisGrid;
  window: WindowArrays;
  /** Max ice probability within the neighbourhood radius (see neighbourhoodMax). */
  iceNearby: Float32Array;
  confidence: InputConfidence;
}

const conf = (p: ProvenanceTag): Confidence => (p.kind === "simulated" ? "low" : p.confidence);

/** Input confidences from the provenance of the data actually loaded. */
export function inputConfidence(
  grid: AnalysisGrid,
  sensors: SensorFields,
  relay: Confidence = "low",
): InputConfidence {
  const f = grid.fields;
  return {
    safeRadius: conf(f.safeRadius5.provenance),
    roughness: conf(f.roughness.provenance),
    boulders: "low", // SIMULATED model (sensors.boulderIndex)
    illumination: conf(grid.horizon.provenance),
    dte: conf(grid.horizon.provenance),
    relay,
    psr: conf(f.psrDistance.provenance),
    ice: sensors.iceStableFraction.provenance.kind === "simulated" ? "low" : "medium", // model on real inputs
  };
}

export function cellInputs(ctx: ScoringContext, i: number): CellInputs {
  const f = ctx.grid.fields;
  const w = ctx.window;
  return {
    safeRadiusM: {
      5: f.safeRadius5.data[i]!,
      8: f.safeRadius8.data[i]!,
      10: f.safeRadius10.data[i]!,
      15: f.safeRadius15.data[i]!,
    },
    slopeP95Deg: f.slopeP95.data[i]!,
    roughnessDeg: f.roughness.data[i]!,
    boulderIndex: boulderIndex(f.roughness.data[i]!, f.slopeP95.data[i]!),
    sunFraction: w.sunFraction[i]!,
    longestNightH: w.longestNightH[i]!,
    dteFraction: w.dteFraction[i]!,
    dteGapH: w.dteGapH[i]!,
    relayFraction: w.relayFraction?.[i],
    relayGapH: w.relayGapH?.[i],
    psrDistanceKm: f.psrDistance.data[i]!,
    iceNearby: ctx.iceNearby[i]!,
  };
}

export function evaluateAt(
  ctx: ScoringContext,
  i: number,
  cfg: ScoringModelConfig,
  weights: FactorWeights,
): CellEvaluation {
  return evaluateCell(cellInputs(ctx, i), cfg, ctx.confidence, weights);
}

export const GATE_BITS: Record<GateId, number> = {
  slope: 1,
  roughness: 2,
  boulders: 4,
  comms: 8,
  darkness: 16,
};

export interface GridScores {
  /** 0..100, NaN for excluded / not evaluated cells. */
  score: Float32Array;
  sigma: Float32Array;
  /** Bitmask of failed gates (GATE_BITS); 0 = passed. 255 = not evaluated (outside the cell set). */
  failed: Uint8Array;
  evaluated: number;
  passed: number;
}

export function scoreGrid(
  ctx: ScoringContext,
  cells: Int32Array,
  cfg: ScoringModelConfig,
  weights: FactorWeights,
): GridScores {
  const n = ctx.grid.geometry.cols * ctx.grid.geometry.rows;
  const score = new Float32Array(n).fill(Number.NaN);
  const sigma = new Float32Array(n).fill(Number.NaN);
  const failed = new Uint8Array(n).fill(255);
  let passed = 0;
  for (const i of cells) {
    const e = evaluateAt(ctx, i, cfg, weights);
    let bits = 0;
    for (const g of e.gates) if (!g.passed) bits |= GATE_BITS[g.id];
    failed[i] = bits;
    if (e.passed) {
      score[i] = e.score;
      sigma[i] = e.sigma;
      passed++;
    }
  }
  return { score, sigma, failed, evaluated: cells.length, passed };
}

/** Max of `values` within `radiusKm` (cell-centre distance) of each cell. NaN values are ignored. */
export function neighbourhoodMax(
  g: GridGeometry,
  values: Float32Array,
  radiusKm: number,
): Float32Array {
  const r = Math.floor((radiusKm * 1000) / g.cellSizeM);
  const r2 = (radiusKm * 1000) ** 2;
  const out = new Float32Array(values.length).fill(Number.NaN);
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      let m = Number.NaN;
      for (let dr = -r; dr <= r; dr++) {
        const rr = row + dr;
        if (rr < 0 || rr >= g.rows) continue;
        for (let dc = -r; dc <= r; dc++) {
          const cc = col + dc;
          if (cc < 0 || cc >= g.cols) continue;
          if ((dr * g.cellSizeM) ** 2 + (dc * g.cellSizeM) ** 2 > r2) continue;
          const v = values[rr * g.cols + cc]!;
          if (!Number.isNaN(v) && !(v <= m)) m = v;
        }
      }
      out[row * g.cols + col] = m;
    }
  }
  return out;
}

export interface Zone {
  rank: number;
  /** The pick (best cell). */
  cell: number;
  score: number;
  sigma: number;
  /** Connected passing cells within the zone radius scoring ≥ pick − drop (includes `cell`). */
  cells: number[];
  x: number;
  y: number;
}

export interface ZoneOptions {
  count: number;
  minSeparationKm: number;
  zoneRadiusKm: number;
  zoneScoreDrop: number;
}

export const DEFAULT_ZONE_OPTIONS: ZoneOptions = {
  count: 3,
  minSeparationKm: 3,
  zoneRadiusKm: 1,
  zoneScoreDrop: 5,
};

/**
 * Greedy spatial non-maximum suppression: best cell first, then skip anything closer than
 * `minSeparationKm` to an earlier pick. Ties: lower sigma, then lower index (deterministic).
 */
export function selectZones(
  g: GridGeometry,
  scores: GridScores,
  cells: Int32Array,
  opts: ZoneOptions = DEFAULT_ZONE_OPTIONS,
): Zone[] {
  const cand = Array.from(cells).filter((i) => !Number.isNaN(scores.score[i]!));
  cand.sort(
    (a, b) =>
      scores.score[b]! - scores.score[a]! ||
      (scores.sigma[a]! || 0) - (scores.sigma[b]! || 0) ||
      a - b,
  );
  const minD2 = (opts.minSeparationKm * 1000) ** 2;
  const picks: Zone[] = [];
  const inSet = new Set(cand);
  for (const i of cand) {
    if (picks.length >= opts.count) break;
    const { x, y } = cellCenter(g, i);
    if (picks.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < minD2)) continue;
    picks.push({
      rank: picks.length + 1,
      cell: i,
      score: scores.score[i]!,
      sigma: scores.sigma[i]!,
      cells: growZone(g, scores, inSet, i, opts),
      x,
      y,
    });
  }
  return picks;
}

/** Flood fill from the pick over 4-connected passing cells within the radius and score band. */
function growZone(
  g: GridGeometry,
  scores: GridScores,
  inSet: Set<number>,
  seed: number,
  opts: ZoneOptions,
): number[] {
  const min = scores.score[seed]! - opts.zoneScoreDrop;
  const c0 = cellCenter(g, seed);
  const r2 = (opts.zoneRadiusKm * 1000) ** 2;
  const seen = new Set([seed]);
  const stack = [seed];
  const out: number[] = [];
  while (stack.length) {
    const i = stack.pop()!;
    out.push(i);
    const row = Math.floor(i / g.cols);
    const col = i % g.cols;
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const rr = row + dr;
      const cc = col + dc;
      if (rr < 0 || rr >= g.rows || cc < 0 || cc >= g.cols) continue;
      const j = rr * g.cols + cc;
      if (seen.has(j)) continue;
      seen.add(j);
      if (!inSet.has(j) || scores.score[j]! < min) continue;
      const c = cellCenter(g, j);
      if ((c.x - c0.x) ** 2 + (c.y - c0.y) ** 2 > r2) continue;
      stack.push(j);
    }
  }
  return out.sort((a, b) => a - b);
}
