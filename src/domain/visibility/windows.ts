/**
 * Turns ephemeris + terrain horizon into operational numbers: % of time sunlit / Earth in view,
 * time to next sunset/earthset, longest night / comms blackout.
 * A body counts as visible when its CENTRE is above the terrain horizon (documented simplification).
 */
import { localSky } from "../ephemeris/localSky";
import type {
  Body,
  BodyVisibility,
  EphemerisSeries,
  Site,
  SiteConditions,
  TimeWindow,
} from "../types";
import { horizonAt } from "./horizon";

/** Indices of ephemeris samples inside a window. */
export function sampleRange(eph: EphemerisSeries, win: TimeWindow): { from: number; to: number } {
  const n = eph.subSolarLon.length;
  const from = Math.max(0, Math.ceil((win.startMs - eph.startMs) / eph.stepMs));
  const to = Math.min(n - 1, Math.floor((win.endMs - eph.startMs) / eph.stepMs));
  return { from, to };
}

/** Coverage of the bundled ephemeris, so the UI can bound the date picker. */
export function ephemerisCoverage(eph: EphemerisSeries): TimeWindow {
  return { startMs: eph.startMs, endMs: eph.startMs + (eph.subSolarLon.length - 1) * eph.stepMs };
}

export function summarizeVisibility(
  body: Body,
  times: number[],
  azimuthDeg: number[],
  elevationDeg: number[],
  horizonDeg: number[],
  stepHours: number,
): BodyVisibility {
  const visible = elevationDeg.map((el, i) => el > horizonDeg[i]!);
  const n = visible.length;
  const count = visible.filter(Boolean).length;

  let hoursToChange: number | null = null;
  for (let i = 1; i < n; i++) {
    if (visible[i] !== visible[0]) {
      hoursToChange = i * stepHours;
      break;
    }
  }

  let longestGap = 0;
  let run = 0;
  for (const v of visible) {
    run = v ? 0 : run + 1;
    longestGap = Math.max(longestGap, run);
  }

  let elSum = 0;
  for (let i = 0; i < n; i++) if (visible[i]) elSum += elevationDeg[i]!;

  return {
    body,
    times,
    azimuthDeg,
    elevationDeg,
    horizonDeg,
    visible,
    fraction: n === 0 ? 0 : count / n,
    hoursToChange,
    visibleAtStart: n > 0 && visible[0]!,
    longestGapHours: longestGap * stepHours,
    meanElevationWhenVisibleDeg: count === 0 ? null : elSum / count,
  };
}

/** Sun and Earth visibility at one site over a time window. */
export function computeConditions(
  site: Site,
  eph: EphemerisSeries,
  win: TimeWindow,
): SiteConditions {
  const { from, to } = sampleRange(eph, win);
  const stepHours = eph.stepMs / 3_600_000;
  const per = (body: Body): BodyVisibility => {
    const times: number[] = [];
    const az: number[] = [];
    const el: number[] = [];
    const hz: number[] = [];
    for (let i = from; i <= to; i++) {
      const sky =
        body === "sun"
          ? localSky(site, { lon: eph.subSolarLon[i]!, lat: eph.subSolarLat[i]! })
          : localSky(
              site,
              { lon: eph.subEarthLon[i]!, lat: eph.subEarthLat[i]! },
              eph.earthDistanceKm[i]!,
            );
      times.push(eph.startMs + i * eph.stepMs);
      az.push(sky.azimuthDeg);
      el.push(sky.elevationDeg);
      hz.push(horizonAt(site.horizon, sky.azimuthDeg));
    }
    return summarizeVisibility(body, times, az, el, hz, stepHours);
  };
  return { siteId: site.id, sun: per("sun"), earth: per("earth") };
}
