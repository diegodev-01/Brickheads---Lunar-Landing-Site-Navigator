/** Score 0..100 → red / amber / green (shared by map markers and list bars). */
export function scoreColor(score: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [242, 84, 91]],
    [50, [242, 179, 61]],
    [100, [60, 207, 142]],
  ];
  const s = Math.max(0, Math.min(100, score));
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i]!;
    const [p0, c0] = stops[i - 1]!;
    if (s <= p1) {
      const t = (s - p0) / (p1 - p0);
      const c = c0.map((v, k) => Math.round(v + (c1[k]! - v) * t));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  }
  return "rgb(60, 207, 142)";
}
