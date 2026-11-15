/**
 * Piecewise-linear normalisation: linear between breakpoints, clamped to the end values outside them.
 * Breakpoints must have strictly increasing x. See docs/scoring-model.md §3.
 */
export type Breakpoints = readonly (readonly [x: number, y: number])[];

export function assertBreakpoints(points: Breakpoints): void {
  if (points.length === 0) throw new Error("piecewise: need at least one breakpoint");
  for (let i = 1; i < points.length; i++) {
    if (!(points[i]![0] > points[i - 1]![0])) {
      throw new Error(`piecewise: x must be strictly increasing (at index ${i})`);
    }
  }
}

/** PL(x; points). NaN in → NaN out (missing data is never silently scored). */
export function pl(x: number, points: Breakpoints): number {
  if (Number.isNaN(x)) return Number.NaN;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    if (x <= x1) {
      const [x0, y0] = points[i - 1]!;
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}
