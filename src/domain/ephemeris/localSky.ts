/**
 * Sun/Earth position in a lander's local sky, from the sub-solar / sub-Earth points on the Moon.
 *
 * Horizons gives, per time step, the point on the Moon directly "under" the Sun and the Earth.
 * With the site's position on the sphere we get the topocentric direction, including the ~1° Earth
 * parallax (the Moon's radius seen from Earth). The Sun is treated as infinitely far.
 * Azimuth is clockwise from local north (toward increasing latitude); elevation is above the
 * smooth-sphere horizon (no atmosphere, no terrain: terrain is applied in visibility/horizon.ts).
 */
import { normalize360, toDeg, toRad } from "../geo/angles";
import { MOON_RADIUS_M } from "../geo/polarStereo";
import type { LonLat, SkyPosition } from "../types";

type Vec3 = [number, number, number];

const unit = ({ lon, lat }: LonLat): Vec3 => {
  const la = toRad(lat);
  const lo = toRad(lon);
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Local east/north/up basis at a site. */
function enu({ lon, lat }: LonLat): { e: Vec3; n: Vec3; u: Vec3 } {
  const la = toRad(lat);
  const lo = toRad(lon);
  return {
    e: [-Math.sin(lo), Math.cos(lo), 0],
    n: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
    u: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)],
  };
}

/**
 * @param site        observer location on the Moon
 * @param subPoint    sub-body point (where the body is at the zenith)
 * @param distanceKm  body distance from the Moon's centre; Infinity for the Sun
 * @param heightM     observer height above the reference sphere (only matters for parallax)
 */
export function localSky(
  site: LonLat,
  subPoint: LonLat,
  distanceKm = Number.POSITIVE_INFINITY,
  heightM = 0,
): SkyPosition {
  const { e, n, u } = enu(site);
  const dir = unit(subPoint);
  let v: Vec3 = dir;
  if (Number.isFinite(distanceKm)) {
    const d = distanceKm * 1000;
    const r = MOON_RADIUS_M + heightM;
    v = [d * dir[0] - r * u[0], d * dir[1] - r * u[1], d * dir[2] - r * u[2]];
  }
  const norm = Math.hypot(v[0], v[1], v[2]);
  const elevationDeg = toDeg(Math.asin(dot(v, u) / norm));
  const azimuthDeg = normalize360(toDeg(Math.atan2(dot(v, e), dot(v, n))));
  return { azimuthDeg, elevationDeg };
}
