import type { Aim } from "@/domain/orbit/aim";

/** "89.45° S, 123.40° E" from a yaw/pitch pair (yaw = east longitude, pitch = latitude). */
export function formatLonLat(aim: Aim): string {
  const lat = `${Math.abs(aim.pitchDeg).toFixed(2)}° ${aim.pitchDeg < 0 ? "S" : "N"}`;
  const east = aim.yawDeg <= 180;
  const lon = `${(east ? aim.yawDeg : 360 - aim.yawDeg).toFixed(2)}° ${east ? "E" : "W"}`;
  return `${lat}, ${lon}`;
}
