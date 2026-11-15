import { describe, expect, it } from "vitest";
import { validateMissionSetup, type MissionConstraints, type MissionSetupInput } from "./setup";
import { formatUtc, julianDayToMs, msToJulianDay, parseUtc } from "./time";

describe("time", () => {
  it("converts to Julian Day using known references", () => {
    expect(msToJulianDay(Date.UTC(2000, 0, 1, 12))).toBeCloseTo(2_451_545.0, 9); // J2000
    expect(msToJulianDay(0)).toBe(2_440_587.5);
    const ms = Date.UTC(2027, 0, 15, 6, 30);
    expect(julianDayToMs(msToJulianDay(ms))).toBe(ms);
  });

  it("parses ISO strings as UTC by default and honours offsets", () => {
    expect(parseUtc("2027-01-15T06:30")).toEqual({ ok: true, ms: Date.UTC(2027, 0, 15, 6, 30) });
    expect(parseUtc("2027-01-15")).toEqual({ ok: true, ms: Date.UTC(2027, 0, 15) });
    expect(parseUtc("2027-01-15T06:30Z")).toEqual({ ok: true, ms: Date.UTC(2027, 0, 15, 6, 30) });
    expect(parseUtc("2027-01-15T08:30+02:00")).toEqual({
      ok: true,
      ms: Date.UTC(2027, 0, 15, 6, 30),
    });
  });

  it("rejects malformed and impossible dates with friendly messages", () => {
    expect(parseUtc("15/01/2027").ok).toBe(false);
    const feb30 = parseUtc("2027-02-30");
    expect(feb30.ok).toBe(false);
    if (!feb30.ok) expect(feb30.message).toMatch(/not a real calendar date/);
    expect(parseUtc("2027-13-01").ok).toBe(false);
    expect(parseUtc("2027-01-01T24:00").ok).toBe(false);
  });

  it("formats to minute precision", () => {
    expect(formatUtc(Date.UTC(2027, 0, 15, 6, 30, 45))).toBe("2027-01-15T06:30Z");
  });
});

const C: MissionConstraints = {
  coverage: { startMs: Date.UTC(2026, 10, 1), endMs: Date.UTC(2028, 0, 1) },
  regionExtent: [-50_000, -50_000, 50_000, 50_000],
  presetIds: ["safety", "science", "comms"],
  roiHalfKmRange: [1, 50],
  windowDaysRange: [1, 60],
};

const base: MissionSetupInput = {
  timeIso: "2027-01-15T06:00Z",
  lat: -89.6,
  lon: 130,
  roiHalfKm: 10,
  windowDays: 14,
  presetId: "safety",
};

describe("validateMissionSetup", () => {
  it("accepts a valid south-pole scenario and derives JD, window and ROI", () => {
    const r = validateMissionSetup(base, C);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.julianDay).toBeCloseTo(2_461_420.75, 6);
    expect(r.value.window.endMs - r.value.window.startMs).toBe(14 * 86_400_000);
    const [x0, , x1] = r.value.roi;
    expect(x1 - x0).toBeLessThanOrEqual(20_000);
  });

  it("accepts Julian Day instead of ISO", () => {
    const r = validateMissionSetup({ ...base, timeIso: "", julianDay: "2461420.75" }, C);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.timeMs).toBe(Date.UTC(2027, 0, 15, 6));
  });

  it("normalises negative longitudes to east longitude", () => {
    const r = validateMissionSetup({ ...base, lon: -90 }, C);
    expect(r.ok && r.value.target.lon).toBe(270);
  });

  it("rejects times outside the ephemeris coverage, including the window end", () => {
    const early = validateMissionSetup({ ...base, timeIso: "2026-01-01" }, C);
    expect(!early.ok && early.errors[0]!.field).toBe("time");
    const lateEnd = validateMissionSetup({ ...base, timeIso: "2027-12-25", windowDays: 14 }, C);
    expect(lateEnd.ok).toBe(false);
  });

  it("rejects targets outside the mapped region with a hint", () => {
    const r = validateMissionSetup({ ...base, lat: -80 }, C);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.message).toMatch(/outside the mapped/);
  });

  it("reports every problem at once", () => {
    const r = validateMissionSetup(
      { timeIso: "", lat: "abc", lon: "", roiHalfKm: 0, windowDays: 999, presetId: "nope" },
      C,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = r.errors.map((e) => e.field).sort();
      expect(fields).toEqual(["lat", "lon", "preset", "roi", "time", "window"]);
    }
  });

  it("clips the ROI to the region near the edge", () => {
    const r = validateMissionSetup({ ...base, lat: -88.42, lon: 90, roiHalfKm: 20 }, C);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.roi[2]).toBe(50_000);
  });
});
