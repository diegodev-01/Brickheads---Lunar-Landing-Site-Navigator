import { describe, expect, it } from "vitest";
import type { BodyVisibility, Site, SiteConditions } from "../types";
import { DEFAULT_CONFIG, DEFAULT_WEIGHTS, type Weights } from "./config";
import { explain } from "./explain";
import { normalize } from "./factors";
import { rankSites, scoreSite } from "./score";

const vis = (body: "sun" | "earth", fraction: number): BodyVisibility => ({
  body,
  times: [],
  azimuthDeg: [],
  elevationDeg: [],
  horizonDeg: [],
  visible: [],
  fraction,
  hoursToChange: null,
  visibleAtStart: fraction > 0,
  longestGapHours: 0,
  meanElevationWhenVisibleDeg: null,
});

const site = (id: string, over: Partial<Site> = {}): Site => ({
  id,
  name: id,
  kind: "candidate",
  lon: 0,
  lat: -89,
  x: 0,
  y: 0,
  slopeMeanDeg: 5,
  roughnessDeg: 3,
  psrDistanceKm: 5,
  inPsr: false,
  provenance: "mock",
  ...over,
});

const cond = (id: string, sun: number, earth: number): SiteConditions => ({
  siteId: id,
  sun: vis("sun", sun),
  earth: vis("earth", earth),
});

const only = (f: keyof Weights): Weights => ({
  sunlight: 0,
  earth: 0,
  slope: 0,
  roughness: 0,
  iceAccess: 0,
  [f]: 1,
});

describe("normalize", () => {
  it("maps best→1 and worst→0 in both directions and clamps", () => {
    expect(normalize(100, { best: 100, worst: 0 })).toBe(1);
    expect(normalize(50, { best: 100, worst: 0 })).toBe(0.5);
    expect(normalize(2, { best: 2, worst: 15 })).toBe(1);
    expect(normalize(15, { best: 2, worst: 15 })).toBe(0);
    expect(normalize(30, { best: 2, worst: 15 })).toBe(0);
    expect(normalize(-1, { best: 2, worst: 15 })).toBe(1);
  });
});

describe("scoreSite", () => {
  it("is 100 for a perfect site and the points add up", () => {
    const s = site("a", { slopeMeanDeg: 1, roughnessDeg: 0.5, psrDistanceKm: 0.1 });
    const r = scoreSite({ site: s, conditions: cond("a", 1, 1), windowDays: 30 }, DEFAULT_WEIGHTS);
    expect(r.score).toBeCloseTo(100);
    expect(r.factors.reduce((t, f) => t + f.points + f.pointsLost, 0)).toBeCloseTo(100);
  });

  it("uses only the weighted factor when the others are zero", () => {
    const r = scoreSite(
      { site: site("a"), conditions: cond("a", 0.25, 0.9), windowDays: 30 },
      only("sunlight"),
    );
    expect(r.score).toBeCloseTo(25);
  });

  it("returns 0 when all weights are zero (no division by zero)", () => {
    const zero: Weights = { sunlight: 0, earth: 0, slope: 0, roughness: 0, iceAccess: 0 };
    const r = scoreSite({ site: site("a"), conditions: cond("a", 1, 1), windowDays: 30 }, zero);
    expect(r.score).toBe(0);
  });

  it("skips factors without data and renormalizes the rest", () => {
    const custom = site("c", {
      slopeMeanDeg: undefined,
      roughnessDeg: undefined,
      psrDistanceKm: undefined,
    });
    const r = scoreSite(
      { site: custom, conditions: cond("c", 0.5, 0.5), windowDays: 30 },
      DEFAULT_WEIGHTS,
    );
    expect(r.missing).toEqual(["slope", "roughness", "iceAccess"]);
    expect(r.score).toBeCloseTo(50);
  });

  it("flags hard limits without changing the score", () => {
    const steep = site("s", { slopeMeanDeg: 20 });
    const flat = site("f", { slopeMeanDeg: 20 });
    const strict = scoreSite(
      { site: steep, conditions: cond("s", 1, 1), windowDays: 30 },
      DEFAULT_WEIGHTS,
    );
    const loose = scoreSite(
      { site: flat, conditions: cond("f", 1, 1), windowDays: 30 },
      DEFAULT_WEIGHTS,
      { ...DEFAULT_CONFIG, limits: { maxSlopeDeg: 90, rejectInPsr: true } },
    );
    expect(strict.flags.map((f) => f.code)).toEqual(["slope"]);
    expect(loose.flags).toEqual([]);
    expect(strict.score).toBeCloseTo(loose.score);
  });
});

describe("rankSites", () => {
  const sites = [site("sunny"), site("talky")];
  const conditions = new Map([
    ["sunny", cond("sunny", 0.95, 0.2)],
    ["talky", cond("talky", 0.4, 0.95)],
  ]);

  it("reorders when weights change", () => {
    expect(rankSites(sites, conditions, only("sunlight"), 30)[0]!.siteId).toBe("sunny");
    expect(rankSites(sites, conditions, only("earth"), 30)[0]!.siteId).toBe("talky");
  });

  it("puts no-go sites after feasible ones even with higher scores", () => {
    const shadowed = site("psr", { inPsr: true, psrDistanceKm: 0 });
    const c = new Map(conditions).set("psr", cond("psr", 1, 1));
    const ranked = rankSites([shadowed, ...sites], c, DEFAULT_WEIGHTS, 30);
    expect(ranked.at(-1)!.siteId).toBe("psr");
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});

describe("explain", () => {
  it("names strengths and weaknesses with point impacts", () => {
    const sites = [site("sunny"), site("talky")];
    const conditions = new Map([
      ["sunny", cond("sunny", 0.95, 0.1)],
      ["talky", cond("talky", 0.4, 0.95)],
    ]);
    const ranked = rankSites(sites, conditions, DEFAULT_WEIGHTS, 29.5);
    const e = explain(
      ranked.find((r) => r.siteId === "sunny")!,
      ranked.length,
    );
    expect(e.headline).toMatch(/rank #\d of 2/);
    expect(e.strengths.join(" ")).toMatch(/Sunlit 95% of the 29.5-day window/);
    expect(e.weaknesses.join(" ")).toMatch(/Earth above the horizon 10%/);
  });
});
