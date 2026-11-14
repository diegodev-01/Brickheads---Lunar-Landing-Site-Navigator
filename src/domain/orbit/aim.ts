/**
 * Landing point from two angles, as seen on a lunar planisphere (the whole Moon unrolled into a
 * 360° × 180° map, equirectangular, centred on the Earth-facing side).
 *
 *   yaw   = rotation around the Moon's spin axis, degrees [0, 360). It is the east longitude:
 *           0° is the centre of the Earth-facing side, 180° the centre of the far side.
 *   pitch = tilt above or below the equator, degrees [-90, 90]. It is the latitude:
 *           +90° is the north pole, -90° the south pole.
 *
 * So the landing point is (lon, lat) = (yaw, pitch); as a 3-D direction from the Moon's centre it
 * is (cos pitch · cos yaw, cos pitch · sin yaw, sin pitch). Pure functions, no framework imports.
 */
import { clamp, normalize180, normalize360, toDeg, toRad } from "../geo/angles";
import type { LonLat } from "../types";

export interface Aim {
  yawDeg: number;
  pitchDeg: number;
}

/** Wraps yaw into [0, 360) and clamps pitch to [-90, 90]. */
export function normalizeAim(aim: Aim): Aim {
  return { yawDeg: normalize360(aim.yawDeg), pitchDeg: clamp(aim.pitchDeg, -90, 90) };
}

/** Landing point selected by a yaw/pitch pair. */
export function aimToLonLat(aim: Aim): LonLat {
  const a = normalizeAim(aim);
  return { lon: a.yawDeg, lat: a.pitchDeg };
}

/** Yaw/pitch pair that selects a ground point (inverse of `aimToLonLat`). */
export function lonLatToAim(p: LonLat): Aim {
  return normalizeAim({ yawDeg: p.lon, pitchDeg: p.lat });
}

/** Unit vector from the Moon's centre to the aimed point (x toward lon 0°, z toward the north pole). */
export function aimToVector(aim: Aim): [x: number, y: number, z: number] {
  const { yawDeg, pitchDeg } = normalizeAim(aim);
  const c = Math.cos(toRad(pitchDeg));
  return [c * Math.cos(toRad(yawDeg)), c * Math.sin(toRad(yawDeg)), Math.sin(toRad(pitchDeg))];
}

/** Yaw/pitch of a direction from the Moon's centre (any length; inverse of `aimToVector`). */
export function vectorToAim(x: number, y: number, z: number): Aim {
  const len = Math.hypot(x, y, z) || 1;
  return normalizeAim({
    yawDeg: toDeg(Math.atan2(y, x)),
    pitchDeg: toDeg(Math.asin(clamp(z / len, -1, 1))),
  });
}

/**
 * Position on the planisphere as fractions of its width and height: u = 0 is the left edge
 * (lon -180°), u = 0.5 the Earth-facing meridian, v = 0 the north pole, v = 1 the south pole.
 */
export function aimToPlanisphere(aim: Aim): { u: number; v: number } {
  const a = normalizeAim(aim);
  return { u: (normalize180(a.yawDeg) + 180) / 360, v: (90 - a.pitchDeg) / 180 };
}

/** Yaw/pitch under a planisphere position (fractions are clamped to the map). */
export function planisphereToAim(u: number, v: number): Aim {
  return normalizeAim({ yawDeg: clamp(u, 0, 1) * 360 - 180, pitchDeg: 90 - clamp(v, 0, 1) * 180 });
}
