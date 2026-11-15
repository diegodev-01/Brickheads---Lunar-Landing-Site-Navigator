import { describe, expect, it } from "vitest";
import { normalize180 } from "../geo/angles";
import { localSky } from "./localSky";
import fixtures from "./__fixtures__/horizons-topocentric.json";
import ephemeris from "../../../public/data/ephemeris.json";

/** Look up the precomputed sub-points for an ISO time (exact hourly sample). */
function subPointsAt(iso: string) {
  const i = Math.round(
    (Date.parse(iso) - Date.parse(ephemeris.start)) / (ephemeris.stepHours * 3600_000),
  );
  return {
    sun: { lon: ephemeris.subSolarLon[i]!, lat: ephemeris.subSolarLat[i]! },
    earth: { lon: ephemeris.subEarthLon[i]!, lat: ephemeris.subEarthLat[i]! },
    earthKm: ephemeris.earthDistanceKm[i]!,
  };
}

describe("localSky vs JPL Horizons topocentric output", () => {
  it.each(fixtures.map((f) => [`${f.site.name} ${f.body} ${f.time}`, f] as const))(
    "%s",
    (_label, f) => {
      const sp = subPointsAt(f.time);
      const sky =
        f.body === "sun" ? localSky(f.site, sp.sun) : localSky(f.site, sp.earth, sp.earthKm);
      // Elevation is what drives power/comms: require agreement within 0.05°.
      expect(Math.abs(sky.elevationDeg - f.elevationDeg)).toBeLessThan(0.05);
      // Azimuth is ill-defined near the zenith; only check it when the body is low.
      if (Math.abs(f.elevationDeg) < 60) {
        expect(Math.abs(normalize180(sky.azimuthDeg - f.azimuthDeg))).toBeLessThan(0.1);
      }
    },
  );
});

describe("localSky geometry", () => {
  it("puts a body at the zenith when the site is the sub-point", () => {
    const sky = localSky({ lon: 10, lat: 20 }, { lon: 10, lat: 20 });
    expect(sky.elevationDeg).toBeCloseTo(90, 6);
  });

  it("puts a body on the horizon 90° away", () => {
    const sky = localSky({ lon: 0, lat: 0 }, { lon: 90, lat: 0 });
    expect(sky.elevationDeg).toBeCloseTo(0, 6);
    expect(sky.azimuthDeg).toBeCloseTo(90, 6); // due east
  });

  it("lowers a finite-distance body by parallax", () => {
    const inf = localSky({ lon: 0, lat: 0 }, { lon: 45, lat: 0 });
    const near = localSky({ lon: 0, lat: 0 }, { lon: 45, lat: 0 }, 384_400);
    expect(near.elevationDeg).toBeLessThan(inf.elevationDeg);
    expect(inf.elevationDeg - near.elevationDeg).toBeCloseTo(0.18, 1);
  });
});
