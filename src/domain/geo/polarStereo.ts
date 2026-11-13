/**
 * Spherical south polar stereographic projection, true scale at the pole.
 * Matches the LOLA/PGDA polar products: +proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400.
 * x grows toward lon 90°E, y grows toward lon 0°; longitude increases clockwise on the map.
 */
import { normalize360, toDeg, toRad } from "./angles";
import type { LonLat } from "../types";

export const MOON_RADIUS_M = 1_737_400;

export function lonLatToXY(
  { lon, lat }: LonLat,
  radiusM = MOON_RADIUS_M,
): { x: number; y: number } {
  const rho = 2 * radiusM * Math.tan(toRad(45 + lat / 2));
  return { x: rho * Math.sin(toRad(lon)), y: rho * Math.cos(toRad(lon)) };
}

export function xyToLonLat(x: number, y: number, radiusM = MOON_RADIUS_M): LonLat {
  const rho = Math.hypot(x, y);
  const lat = toDeg(2 * Math.atan(rho / (2 * radiusM))) - 90;
  const lon = rho === 0 ? 0 : normalize360(toDeg(Math.atan2(x, y)));
  return { lon, lat };
}

/** Great-circle distance between two points on the sphere (m). */
export function surfaceDistanceM(a: LonLat, b: LonLat, radiusM = MOON_RADIUS_M): number {
  const p1 = toRad(a.lat);
  const p2 = toRad(b.lat);
  const dp = p2 - p1;
  const dl = toRad(b.lon - a.lon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * radiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}
