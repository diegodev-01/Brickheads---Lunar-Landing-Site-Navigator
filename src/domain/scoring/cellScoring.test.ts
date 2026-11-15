/** Edge cases listed in docs/scoring-model.md §8. */
import { describe, expect, it } from "vitest";
import { syntheticGrid } from "../grid/__fixtures__/syntheticGrid";
import { cellIndexAt, cellsInExtent } from "../grid/grid";
import { evaluateCell, type CellInputs, type InputConfidence } from "./evaluate";
import { explainCell, readinessOf } from "./explainCell";
import { neighbourhoodMax, scoreGrid, selectZones, type ScoringContext } from "./grid";
import {
  defaultModelConfig,
  normalizeWeights,
  presetWeights,
  SCORING_PRESETS,
  setWeight,
  type FactorWeights,
} from "./model";
import { assertBreakpoints, pl } from "./piecewise";

const HIGH: InputConfidence = {
  safeRadius: "high",
  roughness: "high",
  boulders: "high",
  illumination: "high",
  dte: "high",
  relay: "high",
  psr: "high",
  ice: "high",
};

/** A cell that is excellent on every factor. */
const perfect = (): CellInputs => ({
  safeRadiusM: { 5: 1000, 8: 1000, 10: 1000, 15: 1000 },
  slopeP95Deg: 2,
  roughnessDeg: 0.5,
  boulderIndex: 0,
  sunFraction: 1,
  longestNightH: 0,
  dteFraction: 1,
  dteGapH: 0,
  psrDistanceKm: 0.2,
  iceNearby: 1,
});

const W = presetWeights("balanced");
const sumW = (w: FactorWeights) => w.safety + w.science + w.comms + w.power;

describe("piecewise-linear (PL)", () => {
  const pts = [
    [0, 0],
    [10, 1],
    [20, 0.5],
  ] as const;
  it("clamps below the first and above the last breakpoint", () => {
    expect(pl(-5, pts)).toBe(0);
    expect(pl(99, pts)).toBe(0.5);
  });
  it("is exact on breakpoints and linear between them", () => {
    expect(pl(10, pts)).toBe(1);
    expect(pl(5, pts)).toBeCloseTo(0.5);
    expect(pl(15, pts)).toBeCloseTo(0.75);
  });
  it("handles a single breakpoint and propagates NaN", () => {
    expect(pl(3, [[1, 0.7]])).toBe(0.7);
    expect(pl(Number.NaN, pts)).toBeNaN();
  });
  it("rejects non-increasing breakpoints", () => {
    expect(() =>
      assertBreakpoints([
        [1, 0],
        [1, 1],
      ]),
    ).toThrow();
    expect(() => assertBreakpoints([])).toThrow();
  });
  it("all default curves are valid", () => {
    for (const c of Object.values(defaultModelConfig().curves)) assertBreakpoints(c);
  });
});

describe("weights", () => {
  it("presets sum to 1", () => {
    for (const p of SCORING_PRESETS) expect(sumW(p.weights)).toBeCloseTo(1, 10);
  });
  it("stay normalised after any edit, rescaling the others proportionally", () => {
    const w = setWeight(W, "science", 0.6);
    expect(w.science).toBe(0.6);
    expect(sumW(w)).toBeCloseTo(1, 10);
    expect(w.safety / w.power).toBeCloseTo(W.safety / W.power, 10);
  });
  it("share the remainder equally when the others were all zero", () => {
    const w = setWeight({ safety: 1, science: 0, comms: 0, power: 0 }, "safety", 0.4);
    expect(w.science).toBeCloseTo(0.2);
  });
  it("all-zero restores the fallback preset; negatives are clamped", () => {
    expect(normalizeWeights({ safety: 0, science: 0, comms: 0, power: 0 })).toEqual(W);
    const n = normalizeWeights({ safety: -1, science: 1, comms: 1, power: 0 });
    expect(n.safety).toBe(0);
    expect(n.science).toBe(0.5);
  });
});

describe("gates", () => {
  const cfg = defaultModelConfig();
  it("a value exactly at the threshold passes", () => {
    const c = { ...perfect(), roughnessDeg: 4, boulderIndex: 0.6 };
    c.safeRadiusM[5] = 100;
    const e = evaluateCell(c, cfg, HIGH, W);
    expect(e.passed).toBe(true);
  });
  it("missing data fails the gate as 'no data' (never silently passed)", () => {
    const e = evaluateCell({ ...perfect(), roughnessDeg: Number.NaN }, cfg, HIGH, W);
    const g = e.gates.find((x) => x.id === "roughness")!;
    expect(g.passed).toBe(false);
    expect(g.noData).toBe(true);
    expect(e.score).toBeNaN();
  });
  it("reports every failed gate, and disabled gates are ignored", () => {
    const c = { ...perfect(), roughnessDeg: 9, boulderIndex: 0.9, dteFraction: 0 };
    c.safeRadiusM[5] = 20;
    const failed = evaluateCell(c, cfg, HIGH, W)
      .gates.filter((g) => !g.passed)
      .map((g) => g.id);
    expect(failed).toEqual(["slope", "roughness", "boulders", "comms"]);
    const off = defaultModelConfig();
    off.gates.roughness.enabled = false;
    expect(evaluateCell(c, off, HIGH, W).gates.some((g) => g.id === "roughness")).toBe(false);
  });
  it("slope gate: lander-scale by default, literal P95 as an option", () => {
    const c = { ...perfect(), slopeP95Deg: 12 };
    expect(evaluateCell(c, cfg, HIGH, W).passed).toBe(true);
    const p95 = defaultModelConfig();
    p95.gates.slope.mode = "p95";
    expect(evaluateCell(c, p95, HIGH, W).gates[0]).toMatchObject({ id: "slope", passed: false });
  });
  it("comms gate passes on relay contact even with no Earth in view", () => {
    const c = { ...perfect(), dteFraction: 0, relayFraction: 0.4, relayGapH: 10 };
    expect(evaluateCell(c, cfg, HIGH, W).passed).toBe(true);
  });
  it("flags gates fed by simulated inputs", () => {
    const e = evaluateCell(perfect(), cfg, { ...HIGH, boulders: "low" }, W);
    expect(e.gates.find((g) => g.id === "boulders")!.simulated).toBe(true);
  });
  it("darkness gate is off by default and fails a never-lit cell when enabled", () => {
    const dark = { ...perfect(), sunFraction: 0 };
    expect(evaluateCell(dark, cfg, HIGH, W).passed).toBe(true);
    const on = defaultModelConfig();
    on.gates.darkness.enabled = true;
    expect(evaluateCell(dark, on, HIGH, W).passed).toBe(false);
  });
});

describe("score and uncertainty", () => {
  const cfg = defaultModelConfig();
  it("a perfect cell scores 100 and contributions sum to the score", () => {
    const e = evaluateCell(perfect(), cfg, HIGH, W);
    expect(e.score).toBeCloseTo(100, 6);
    expect(e.factors.reduce((s, f) => s + f.points, 0)).toBeCloseTo(e.score, 9);
  });
  it("all-high inputs give high confidence", () => {
    const e = evaluateCell(perfect(), cfg, HIGH, W);
    expect(e.sigma).toBeCloseTo(
      100 * 0.05 * Math.sqrt(0.35 ** 2 + 0.2 ** 2 + 0.2 ** 2 + 0.25 ** 2),
      6,
    );
    expect(e.confidence).toBe("high");
  });
  it("a single low-confidence factor with weight 1 gives σ = 25", () => {
    const allLow = Object.fromEntries(
      Object.keys(HIGH).map((k) => [k, "low"]),
    ) as unknown as InputConfidence;
    const e = evaluateCell(perfect(), cfg, allLow, { safety: 1, science: 0, comms: 0, power: 0 });
    expect(e.sigma).toBeCloseTo(25, 6);
    expect(e.confidence).toBe("low");
  });
  it("weights change the ranking between two cells", () => {
    const sunny = { ...perfect(), psrDistanceKm: 9, iceNearby: 0 };
    const icy = { ...perfect(), sunFraction: 0.2, longestNightH: 150 };
    const sci = presetWeights("science");
    const pow = { safety: 0.2, science: 0.05, comms: 0.15, power: 0.6 };
    expect(evaluateCell(icy, cfg, HIGH, sci).score).toBeGreaterThan(
      evaluateCell(sunny, cfg, HIGH, sci).score,
    );
    expect(evaluateCell(sunny, cfg, HIGH, pow).score).toBeGreaterThan(
      evaluateCell(icy, cfg, HIGH, pow).score,
    );
  });
  it("relay replaces DTE when it is better", () => {
    const c = { ...perfect(), dteFraction: 0.1, dteGapH: 300, relayFraction: 0.9, relayGapH: 8 };
    const comms = evaluateCell(c, cfg, HIGH, W).factors.find((f) => f.id === "comms")!;
    expect(comms.raw.viaRelay).toBe(1);
    expect(comms.normalized).toBeGreaterThan(0.9);
  });
});

describe("explanations", () => {
  const cfg = defaultModelConfig();
  it("names the top strengths and the main drawback, with numbers", () => {
    const c = { ...perfect(), longestNightH: 180, sunFraction: 0.3 };
    const x = explainCell(evaluateCell(c, cfg, HIGH, W), "Zone A");
    expect(x.sentence).toMatch(/^Zone A scores \d+ ± \d+: /);
    expect(x.sentence).toMatch(/main drawback is long nights \(up to 7\.5 days\)/);
    expect(x.reasons.length).toBeGreaterThanOrEqual(3);
    expect(x.reasons.length).toBeLessThanOrEqual(4);
  });
  it("an excluded cell names every failed gate", () => {
    const c = { ...perfect(), roughnessDeg: 9, dteFraction: 0 };
    const x = explainCell(evaluateCell(c, cfg, HIGH, W));
    expect(x.readiness).toBe("excluded");
    expect(x.headline).toBe("Not safe to land here");
    expect(x.sentence).toMatch(/too rough/);
    expect(x.sentence).toMatch(/no radio contact/);
  });
  it("never praises a factor that a failed gate contradicts", () => {
    const c = { ...perfect() };
    c.safeRadiusM[5] = 80;
    const x = explainCell(evaluateCell(c, cfg, HIGH, W));
    expect(x.reasons.some((r) => /flat spot/.test(r.text) && r.text.startsWith("Otherwise"))).toBe(
      false,
    );
    expect(x.reasons.some((r) => r.text.startsWith("Otherwise"))).toBe(true);
  });
  it("maps scores to readiness bands", () => {
    const e = evaluateCell(perfect(), cfg, HIGH, W);
    expect(readinessOf({ ...e, score: 80 })).toBe("good");
    expect(readinessOf({ ...e, score: 60 })).toBe("possible");
    expect(readinessOf({ ...e, score: 40 })).toBe("poor");
  });
  it("mentions simulated inputs when asked", () => {
    const x = explainCell(evaluateCell(perfect(), cfg, HIGH, W), "X", {
      simulatedInputs: ["Boulder hazard"],
    });
    expect(x.reasons.some((r) => r.text.includes("simulated"))).toBe(true);
  });
});

describe("grid scoring and top-3 NMS", () => {
  // 20 × 20 cells of 500 m (10 × 10 km), score field controlled through sun fraction.
  const grid = syntheticGrid({
    cols: 20,
    rows: 20,
    fields: {
      safeRadius5: () => 500,
      safeRadius8: () => 500,
      safeRadius10: () => 500,
      safeRadius15: () => 500,
      roughness: () => 1,
      slopeP95: () => 3,
      psrDistance: () => 1,
    },
  });
  const n = 400;
  const sun = new Float32Array(n).fill(0.1);
  // Three peaks: two adjacent (1 km apart) and one far away.
  const a = cellIndexAt(grid.geometry, -2250, 2250)!;
  const b = cellIndexAt(grid.geometry, -1250, 2250)!;
  const far = cellIndexAt(grid.geometry, 3750, -3750)!;
  const mid = cellIndexAt(grid.geometry, -1750, 2250)!; // between a and b, so the zone is connected
  sun[a] = 1;
  sun[mid] = 0.995;
  sun[b] = 0.99;
  sun[far] = 0.9;
  const ctx: ScoringContext = {
    grid,
    window: {
      sunFraction: sun,
      longestNightH: new Float32Array(n),
      dteFraction: new Float32Array(n).fill(0.5),
      dteGapH: new Float32Array(n).fill(12),
    },
    iceNearby: new Float32Array(n).fill(0.2),
    confidence: HIGH,
  };
  const cfg = defaultModelConfig();
  const all = cellsInExtent(grid.geometry);
  const scores = scoreGrid(ctx, all, cfg, W);

  it("scores every evaluated cell and marks the rest as not evaluated", () => {
    expect(scores.passed).toBe(400);
    const roi = cellsInExtent(grid.geometry, [-1000, -1000, 1000, 1000]);
    const s = scoreGrid(ctx, roi, cfg, W);
    expect(s.evaluated).toBe(roi.length);
    expect(s.failed[0]).toBe(255);
  });

  it("keeps picks at least D_min apart (skips the adjacent runner-up)", () => {
    const z = selectZones(grid.geometry, scores, all);
    expect(z.map((p) => p.cell).slice(0, 2)).toEqual([a, far]);
    for (const p of z)
      for (const q of z)
        if (p !== q) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(3000);
  });

  it("is deterministic on ties and returns fewer zones when space runs out", () => {
    const flat: ScoringContext = {
      ...ctx,
      window: { ...ctx.window, sunFraction: new Float32Array(n).fill(0.5) },
    };
    const s = scoreGrid(flat, all, cfg, W);
    const z1 = selectZones(grid.geometry, s, all, {
      count: 50,
      minSeparationKm: 3,
      zoneRadiusKm: 1,
      zoneScoreDrop: 5,
    });
    const z2 = selectZones(grid.geometry, s, all, {
      count: 50,
      minSeparationKm: 3,
      zoneRadiusKm: 1,
      zoneScoreDrop: 5,
    });
    expect(z1.map((z) => z.cell)).toEqual(z2.map((z) => z.cell));
    expect(z1[0]!.cell).toBe(0); // lowest index wins a tie
    expect(z1.length).toBeLessThan(50); // a 10 × 10 km area fits only a few picks 3 km apart
  });

  it("handles an empty ROI and an all-excluded ROI", () => {
    expect(selectZones(grid.geometry, scores, new Int32Array(0))).toEqual([]);
    const strict = defaultModelConfig();
    strict.gates.slope.radiusM = 10_000;
    const s = scoreGrid(ctx, all, strict, W);
    expect(s.passed).toBe(0);
    expect(selectZones(grid.geometry, s, all)).toEqual([]);
  });

  it("grows a zone over nearby cells within the score band only", () => {
    const z = selectZones(grid.geometry, scores, all)[0]!;
    expect(z.cells).toContain(a);
    expect(z.cells).toEqual(expect.arrayContaining([mid, b])); // connected, within 5 points
    expect(z.cells).not.toContain(far);
    expect(z.cells.every((c) => scores.score[c]! >= z.score - 5)).toBe(true);
  });

  it("neighbourhoodMax spreads a value over the radius only", () => {
    const v = new Float32Array(n);
    v[a] = 1;
    const m = neighbourhoodMax(grid.geometry, v, 1);
    expect(m[b]).toBe(1); // 1 km away
    expect(m[far]).toBe(0);
  });
});
