/** Angle helpers shared by the domain layer. All public APIs take and return degrees. */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const toRad = (deg: number): number => deg * DEG;
export const toDeg = (rad: number): number => rad * RAD;

/** Normalizes an azimuth/longitude to the half-open range [0, 360). */
export function normalize360(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r === 360 ? 0 : r;
}

/** Normalizes an angle to the half-open range [-180, 180). */
export function normalize180(deg: number): number {
  return normalize360(deg + 180) - 180;
}

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));
