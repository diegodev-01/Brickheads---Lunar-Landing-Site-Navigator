/**
 * Mission Setup: the user's inputs (time, target, region of interest, scoring preset), validated
 * against what the bundled data can answer. Errors are written for non-experts.
 */
import { lonLatToXY } from "../geo/polarStereo";
import { normalize360 } from "../geo/angles";
import type { LonLat, TimeWindow } from "../types";
import { julianDayToMs, msToJulianDay, parseUtc } from "./time";

/** Raw form input. Exactly one of `timeIso` / `julianDay` drives the time. */
export interface MissionSetupInput {
  timeIso?: string;
  julianDay?: number | string;
  lat: number | string;
  lon: number | string;
  /** Half-width of the square region of interest around the target, km. */
  roiHalfKm: number | string;
  /** Length of the analysis window starting at the landing time, days. */
  windowDays: number | string;
  presetId: string;
}

/** Square ROI in polar stereographic metres: [minX, minY, maxX, maxY]. */
export type Extent = [number, number, number, number];

export interface MissionSetup {
  timeMs: number;
  julianDay: number;
  target: LonLat & { x: number; y: number };
  roiHalfKm: number;
  roi: Extent;
  window: TimeWindow;
  presetId: string;
}

export interface MissionConstraints {
  /** Time range covered by the ephemeris. */
  coverage: TimeWindow;
  /** The precomputed region; the target must sit inside it. */
  regionExtent: Extent;
  presetIds: readonly string[];
  roiHalfKmRange: [number, number];
  windowDaysRange: [number, number];
}

export type SetupField = "time" | "lat" | "lon" | "roi" | "window" | "preset";

export interface SetupError {
  field: SetupField;
  message: string;
}

export type SetupResult = { ok: true; value: MissionSetup } | { ok: false; errors: SetupError[] };

const DAY = 86_400_000;

function num(v: number | string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function validateMissionSetup(input: MissionSetupInput, c: MissionConstraints): SetupResult {
  const errors: SetupError[] = [];

  // Time
  let timeMs: number | null = null;
  const jd = num(input.julianDay);
  if (input.timeIso && input.timeIso.trim() !== "") {
    const p = parseUtc(input.timeIso);
    if (p.ok) timeMs = p.ms;
    else errors.push({ field: "time", message: p.message });
  } else if (jd !== null) {
    timeMs = julianDayToMs(jd);
  } else {
    errors.push({ field: "time", message: "Pick a landing date and time (UTC)." });
  }

  const days = num(input.windowDays);
  const [dMin, dMax] = c.windowDaysRange;
  if (days === null || days < dMin || days > dMax) {
    errors.push({
      field: "window",
      message: `The analysis window must be between ${dMin} and ${dMax} days.`,
    });
  }

  if (timeMs !== null) {
    const end = timeMs + (days ?? dMin) * DAY;
    if (timeMs < c.coverage.startMs || end > c.coverage.endMs) {
      errors.push({
        field: "time",
        message: `Sun and Earth positions are only bundled from ${fmtDate(c.coverage.startMs)} to ${fmtDate(
          c.coverage.endMs,
        )}. Choose a landing time (plus window) inside that range.`,
      });
    }
  }

  // Target
  const lat = num(input.lat);
  const lonRaw = num(input.lon);
  if (lat === null || lat < -90 || lat > 90) {
    errors.push({ field: "lat", message: "Latitude must be a number between −90 and 90." });
  }
  if (lonRaw === null) {
    errors.push({ field: "lon", message: "Longitude must be a number (degrees east)." });
  }

  let target: MissionSetup["target"] | null = null;
  if (lat !== null && lat >= -90 && lat <= 90 && lonRaw !== null) {
    const lon = normalize360(lonRaw);
    const { x, y } = lonLatToXY({ lon, lat });
    const [x0, y0, x1, y1] = c.regionExtent;
    if (x < x0 || x > x1 || y < y0 || y > y1) {
      errors.push({
        field: "lat",
        message:
          "That point is outside the mapped south-pole region. Try a latitude closer to −90° (e.g. −89.5).",
      });
    } else {
      target = { lat, lon, x, y };
    }
  }

  // ROI
  const half = num(input.roiHalfKm);
  const [hMin, hMax] = c.roiHalfKmRange;
  if (half === null || half < hMin || half > hMax) {
    errors.push({
      field: "roi",
      message: `The search area must be between ${hMin * 2} and ${hMax * 2} km wide.`,
    });
  }

  if (!c.presetIds.includes(input.presetId)) {
    errors.push({ field: "preset", message: "Choose one of the scoring presets." });
  }

  if (errors.length > 0 || timeMs === null || target === null || half === null || days === null) {
    return { ok: false, errors };
  }

  // Clip the ROI to the region so the map never asks for cells that do not exist.
  const [x0, y0, x1, y1] = c.regionExtent;
  const h = half * 1000;
  const roi: Extent = [
    Math.max(x0, target.x - h),
    Math.max(y0, target.y - h),
    Math.min(x1, target.x + h),
    Math.min(y1, target.y + h),
  ];

  return {
    ok: true,
    value: {
      timeMs,
      julianDay: msToJulianDay(timeMs),
      target,
      roiHalfKm: half,
      roi,
      window: { startMs: timeMs, endMs: timeMs + days * DAY },
      presetId: input.presetId,
    },
  };
}
