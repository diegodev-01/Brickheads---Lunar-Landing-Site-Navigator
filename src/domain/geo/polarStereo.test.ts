import { describe, expect, it } from "vitest";
import { lonLatToXY, surfaceDistanceM, xyToLonLat } from "./polarStereo";

describe("south polar stereographic", () => {
  it("maps the pole to the origin", () => {
    const { x, y } = lonLatToXY({ lon: 123, lat: -90 });
    expect(Math.hypot(x, y)).toBeLessThan(1e-6);
  });

  it("puts lon 0 on +y and lon 90°E on +x", () => {
    const a = lonLatToXY({ lon: 0, lat: -89 });
    const b = lonLatToXY({ lon: 90, lat: -89 });
    expect(a.x).toBeCloseTo(0, 6);
    expect(a.y).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThan(0);
    expect(b.y).toBeCloseTo(0, 6);
  });

  it("round-trips (IAU Shackleton centre)", () => {
    const p = { lon: 129.78, lat: -89.67 };
    const back = xyToLonLat(lonLatToXY(p).x, lonLatToXY(p).y);
    expect(back.lon).toBeCloseTo(p.lon, 9);
    expect(back.lat).toBeCloseTo(p.lat, 9);
  });

  it("is ~true scale near the pole", () => {
    const { x, y } = lonLatToXY({ lon: 0, lat: -89 });
    const arc = surfaceDistanceM({ lon: 0, lat: -90 }, { lon: 0, lat: -89 });
    expect(Math.hypot(x, y) / arc).toBeCloseTo(1, 4);
  });
});
