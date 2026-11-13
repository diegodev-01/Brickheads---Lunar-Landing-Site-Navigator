import { normalize360 } from "../geo/angles";
import type { HorizonMask } from "../types";

/** Terrain horizon elevation (deg) at an azimuth, linearly interpolated with 359°→0° wrap-around. */
export function horizonAt(mask: HorizonMask | undefined, azimuthDeg: number): number {
  if (!mask || mask.elevationDeg.length === 0) return 0; // smooth sphere: the geometric horizon
  const n = mask.elevationDeg.length;
  const pos = normalize360(azimuthDeg - mask.startAzDeg) / mask.stepDeg;
  const i0 = Math.floor(pos) % n;
  const i1 = (i0 + 1) % n;
  const t = pos - Math.floor(pos);
  return mask.elevationDeg[i0]! * (1 - t) + mask.elevationDeg[i1]! * t;
}
