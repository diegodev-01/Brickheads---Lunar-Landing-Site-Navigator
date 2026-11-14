import { describe, expect, it } from "vitest";
import type { BodyVisibility, SiteConditions } from "../types";
import { evaluateCell, type CellInputs, type InputConfidence } from "./evaluate";
import { defaultModelConfig, presetWeights } from "./model";
import { plainGlobalSummary, plainSummary } from "./plainSummary";

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

const summarize = (c: CellInputs) =>
  plainSummary(evaluateCell(c, defaultModelConfig(), HIGH, presetWeights("balanced")));

describe("plain-language summary", () => {
  it("gives a clear positive verdict with four rated rows for an excellent cell", () => {
    const s = summarize(perfect());
    expect(s.readiness).toBe("good");
    expect(s.verdict).toBe("Good place to land");
    expect(s.score).toBeGreaterThanOrEqual(75);
    expect(s.rows.map((r) => r.id)).toEqual(["safety", "power", "comms", "science"]);
    for (const r of s.rows) {
      expect(r.rating).toBe("great");
      expect(r.stars).toBe(5);
    }
    expect(s.rows[1]!.text).toContain("100 %");
  });

  it("rules out a spot with no flat ground and says why in everyday words", () => {
    const s = summarize({ ...perfect(), safeRadiusM: { 5: 0, 8: 0, 10: 0, 15: 0 } });
    expect(s.readiness).toBe("excluded");
    expect(s.verdict).toBe("Do not land here");
    expect(s.score).toBeNull();
    const safety = s.rows.find((r) => r.id === "safety")!;
    expect(safety.rating).toBe("blocked");
    expect(safety.stars).toBe(0);
    expect(safety.text).toMatch(/too steep/i);
    // factors that are fine stay rated normally
    expect(s.rows.find((r) => r.id === "power")!.rating).toBe("great");
  });

  it("flags permanent darkness on the sunlight row", () => {
    const s = summarize({ ...perfect(), sunFraction: 0, longestNightH: 336 });
    expect(s.rows.find((r) => r.id === "power")!.text).toMatch(/never rises/);
  });

  it("mentions the relay when it is the better link", () => {
    const s = summarize({
      ...perfect(),
      dteFraction: 0.1,
      dteGapH: 200,
      relayFraction: 0.9,
      relayGapH: 5,
    });
    expect(s.rows.find((r) => r.id === "comms")!.text).toContain("relay satellite");
  });
});

describe("plain-language summary outside the detailed grid", () => {
  const body = (fraction: number, gap: number): BodyVisibility => ({
    body: "sun",
    times: [],
    azimuthDeg: [],
    elevationDeg: [],
    horizonDeg: [],
    visible: [],
    fraction,
    hoursToChange: null,
    visibleAtStart: fraction > 0,
    longestGapHours: gap,
    meanElevationWhenVisibleDeg: null,
  });
  const cond = (sun: number, earth: number): SiteConditions => ({
    siteId: "AIM",
    sun: body(sun, 300),
    earth: body(earth, earth > 0 ? 0 : 336),
  });

  it("never guesses ground safety or ice", () => {
    const s = plainGlobalSummary(cond(0.5, 1), "south pole zone");
    expect(s.readiness).toBe("unknown");
    expect(s.score).toBeNull();
    expect(s.rows.find((r) => r.id === "safety")!.rating).toBe("unknown");
    expect(s.rows.find((r) => r.id === "science")!.rating).toBe("unknown");
    expect(s.advice).toContain("south pole zone");
  });

  it("rates sunlight and Earth contact from the ephemeris", () => {
    const s = plainGlobalSummary(cond(0.5, 1), "south pole zone");
    expect(s.rows.find((r) => r.id === "power")!.rating).toBe("ok");
    expect(s.rows.find((r) => r.id === "comms")!.rating).toBe("great");
  });

  it("explains the far side: Earth never in the sky", () => {
    const s = plainGlobalSummary(cond(0.5, 0), "south pole zone");
    const comms = s.rows.find((r) => r.id === "comms")!;
    expect(comms.rating).toBe("weak");
    expect(comms.text).toMatch(/far side/);
  });
});
