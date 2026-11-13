import { describe, expect, it } from "vitest";
import { clamp, normalize180, normalize360, toDeg, toRad } from "./angles";

describe("angles", () => {
  it("round-trips degrees and radians", () => {
    expect(toDeg(toRad(123.456))).toBeCloseTo(123.456, 12);
  });

  it("normalizes to [0, 360)", () => {
    expect(normalize360(-10)).toBe(350);
    expect(normalize360(360)).toBe(0);
    expect(normalize360(725)).toBe(5);
  });

  it("normalizes to [-180, 180)", () => {
    expect(normalize180(190)).toBe(-170);
    expect(normalize180(-180)).toBe(-180);
    expect(normalize180(180)).toBe(-180);
  });

  it("clamps", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
  });
});
