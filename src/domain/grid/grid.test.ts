import { describe, expect, it } from "vitest";
import { hzQ, syntheticGrid } from "./__fixtures__/syntheticGrid";
import { cellCenter, cellHorizonAt, cellIndexAt, cellRowCol, cellsInExtent } from "./grid";

const grid = syntheticGrid({ cols: 4, rows: 3, cellSizeM: 1000 }); // x ∈ [−2, 2] km, y ∈ [−1.5, 1.5] km

describe("grid indexing", () => {
  it("uses row 0 at the top (max y)", () => {
    expect(cellIndexAt(grid.geometry, -1999, 1499)).toBe(0);
    expect(cellIndexAt(grid.geometry, 1999, -1499)).toBe(11);
    expect(cellRowCol(grid.geometry, 6)).toEqual({ row: 1, col: 2 });
  });

  it("round-trips centre → index for every cell", () => {
    for (let i = 0; i < 12; i++) {
      const c = cellCenter(grid.geometry, i);
      expect(cellIndexAt(grid.geometry, c.x, c.y)).toBe(i);
    }
  });

  it("returns null outside the grid", () => {
    expect(cellIndexAt(grid.geometry, 2001, 0)).toBeNull();
    expect(cellIndexAt(grid.geometry, 0, -1501)).toBeNull();
  });

  it("selects cells whose centre is inside an extent", () => {
    expect(Array.from(cellsInExtent(grid.geometry, [-1000, -500, 1000, 500]))).toEqual([5, 6]);
    expect(cellsInExtent(grid.geometry).length).toBe(12);
  });
});

describe("cellHorizonAt", () => {
  it("decodes the quantised value and wraps 358° to bin 0", () => {
    const g = syntheticGrid({ cols: 1, rows: 1 });
    g.horizon.data[0] = hzQ(3); // bin 0 (az 0°)
    g.horizon.data[1] = hzQ(-1); // bin 1 (az 4°)
    expect(cellHorizonAt(g.horizon, 0, 358.5)).toBeCloseTo(3, 6);
    expect(cellHorizonAt(g.horizon, 0, 1.9)).toBeCloseTo(3, 6);
    expect(cellHorizonAt(g.horizon, 0, 2.1)).toBeCloseTo(-1, 6);
  });
});
