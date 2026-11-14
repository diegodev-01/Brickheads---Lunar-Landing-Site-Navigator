import { describe, expect, it } from "vitest";
import {
  aimToLonLat,
  aimToPlanisphere,
  aimToVector,
  lonLatToAim,
  normalizeAim,
  planisphereToAim,
  vectorToAim,
} from "./aim";

describe("planisphere aim (yaw + pitch → landing point)", () => {
  it("uses yaw as east longitude and pitch as latitude", () => {
    expect(aimToLonLat({ yawDeg: 45, pitchDeg: -30 })).toEqual({ lon: 45, lat: -30 });
  });

  it("wraps yaw to [0, 360) and clamps pitch to the poles", () => {
    expect(normalizeAim({ yawDeg: -90, pitchDeg: 0 }).yawDeg).toBe(270);
    expect(normalizeAim({ yawDeg: 725, pitchDeg: 0 }).yawDeg).toBe(5);
    expect(normalizeAim({ yawDeg: 0, pitchDeg: -123 }).pitchDeg).toBe(-90);
    expect(normalizeAim({ yawDeg: 0, pitchDeg: 95 }).pitchDeg).toBe(90);
  });

  it("round-trips a ground point", () => {
    const p = { lon: 222.5, lat: -88.4 };
    expect(aimToLonLat(lonLatToAim(p))).toEqual(p);
  });

  it("gives the direction from the Moon's centre", () => {
    const close = (a: number[], b: number[]) =>
      a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 12));
    close(aimToVector({ yawDeg: 0, pitchDeg: 0 }), [1, 0, 0]); // centre of the near side
    close(aimToVector({ yawDeg: 90, pitchDeg: 0 }), [0, 1, 0]); // eastern limb
    close(aimToVector({ yawDeg: 180, pitchDeg: 0 }), [-1, 0, 0]); // centre of the far side
    close(aimToVector({ yawDeg: 77, pitchDeg: -90 }), [0, 0, -1]); // south pole, any yaw
    const v = aimToVector({ yawDeg: 123, pitchDeg: 37 });
    expect(Math.hypot(...v)).toBeCloseTo(1, 12);
  });

  it("recovers yaw and pitch from a direction of any length", () => {
    const aim = { yawDeg: 301.25, pitchDeg: -64.5 };
    const [x, y, z] = aimToVector(aim);
    const back = vectorToAim(x * 1737.4, y * 1737.4, z * 1737.4);
    expect(back.yawDeg).toBeCloseTo(aim.yawDeg, 9);
    expect(back.pitchDeg).toBeCloseTo(aim.pitchDeg, 9);
  });

  it("places points on the planisphere: near side in the middle, north on top", () => {
    expect(aimToPlanisphere({ yawDeg: 0, pitchDeg: 0 })).toEqual({ u: 0.5, v: 0.5 });
    expect(aimToPlanisphere({ yawDeg: 90, pitchDeg: 90 })).toEqual({ u: 0.75, v: 0 });
    expect(aimToPlanisphere({ yawDeg: 270, pitchDeg: -90 })).toEqual({ u: 0.25, v: 1 });
    expect(aimToPlanisphere({ yawDeg: 180, pitchDeg: 0 }).u).toBe(0); // far side on the left edge
  });

  it("turns a click on the planisphere back into yaw and pitch", () => {
    expect(planisphereToAim(0.5, 0.5)).toEqual({ yawDeg: 0, pitchDeg: 0 });
    expect(planisphereToAim(0.25, 1)).toEqual({ yawDeg: 270, pitchDeg: -90 });
    const aim = { yawDeg: 200, pitchDeg: -45 };
    const { u, v } = aimToPlanisphere(aim);
    const back = planisphereToAim(u, v);
    expect(back.yawDeg).toBeCloseTo(200, 9);
    expect(back.pitchDeg).toBeCloseTo(-45, 9);
    // clicks outside the map are clamped to its edge
    expect(planisphereToAim(-0.2, 1.4)).toEqual({ yawDeg: 180, pitchDeg: -90 });
  });
});
