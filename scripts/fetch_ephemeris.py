"""Fetch Sun/Earth geometry for the Moon from the JPL Horizons API.

Outputs
-------
public/data/ephemeris.json
    Hourly sub-solar and sub-Earth points on the Moon (MEAN_ME frame, east longitude) plus the
    Earth-Moon distance. The browser turns these into Sun/Earth azimuth/elevation for ANY site
    (see src/domain/ephemeris/localSky.ts), so no NASA call is needed at runtime.

src/domain/ephemeris/__fixtures__/horizons-topocentric.json
    A handful of topocentric az/el values computed by Horizons itself for user-defined lunar
    sites. Unit tests compare our TypeScript geometry against them.

Usage:  python scripts/fetch_ephemeris.py [--start 2026-11-01] [--stop 2028-01-01] [--step 1h]
"""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
ROOT = Path(__file__).resolve().parent.parent
AU_KM = 149_597_870.7


def horizons(params: dict[str, str]) -> str:
    query = {"format": "json", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'", "CSV_FORMAT": "'YES'"}
    query.update({k: f"'{v}'" for k, v in params.items()})
    url = f"{API}?{urllib.parse.urlencode(query)}"
    req = urllib.request.Request(url, headers={"User-Agent": "lunar-landing-site-navigator/0.1"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.load(resp)
    if "error" in payload:
        raise RuntimeError(payload["error"])
    return payload["result"]


def table_rows(result: str) -> list[list[str]]:
    """Return the CSV rows between $$SOE and $$EOE."""
    body = result.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    return [[c.strip() for c in line.split(",")] for line in body.strip().splitlines()]


def parse_time(s: str) -> str:
    dt = datetime.strptime(s, "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def fetch_series(start: str, stop: str, step: str) -> dict:
    # Observer = Earth geocenter, target = Moon.
    #  q14 -> observer (Earth) sub-longitude/latitude on the Moon  => direction of Earth from the Moon
    #  q15 -> sub-solar longitude/latitude on the Moon                => direction of the Sun
    #  q20 -> observer range (au)                                      => Earth distance for parallax
    result = horizons(
        {
            "COMMAND": "301",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": "500@399",
            "START_TIME": start,
            "STOP_TIME": stop,
            "STEP_SIZE": step,
            "QUANTITIES": "14,15,20",
            "ANG_FORMAT": "DEG",
        }
    )
    rows = table_rows(result)
    # CSV columns: date, solar-presence flag, lunar-presence flag, ObsSubLon, ObsSubLat, SunSubLon, SunSubLat, delta, deldot, ...
    times, e_lon, e_lat, s_lon, s_lat, dist = [], [], [], [], [], []
    for r in rows:
        times.append(parse_time(r[0]))
        e_lon.append(round(float(r[3]), 4))
        e_lat.append(round(float(r[4]), 4))
        s_lon.append(round(float(r[5]), 4))
        s_lat.append(round(float(r[6]), 4))
        dist.append(round(float(r[7]) * AU_KM))
    step_hours = (
        datetime.fromisoformat(times[1].replace("Z", "+00:00"))
        - datetime.fromisoformat(times[0].replace("Z", "+00:00"))
    ).total_seconds() / 3600
    return {
        "provenance": "real",
        "source": "JPL Horizons API (DE441), observer 500@399, target 301, quantities 14,15,20",
        "frame": "Moon MEAN_ME, east longitude, degrees",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "start": times[0],
        "stepHours": step_hours,
        "count": len(times),
        "subSolarLon": s_lon,
        "subSolarLat": s_lat,
        "subEarthLon": e_lon,
        "subEarthLat": e_lat,
        "earthDistanceKm": dist,
    }


def fetch_fixtures() -> list[dict]:
    """Topocentric az/el from Horizons for user-defined lunar surface sites (airless, no terrain)."""
    sites = [
        {"name": "south-pole-test", "lat": -89.5, "lon": 0.0},
        {"name": "de-gerlache-test", "lat": -88.485, "lon": 271.655},
        {"name": "near-side-equator-test", "lat": 0.674, "lon": 23.473},
    ]
    out = []
    for site in sites:
        for body, code in (("sun", "10"), ("earth", "399")):
            result = horizons(
                {
                    "COMMAND": code,
                    "EPHEM_TYPE": "OBSERVER",
                    "CENTER": "coord@301",
                    "COORD_TYPE": "GEODETIC",
                    "SITE_COORD": f"{site['lon']},{site['lat']},0",
                    "START_TIME": "2026-12-01",
                    "STOP_TIME": "2027-01-01",
                    "STEP_SIZE": "7d",
                    "QUANTITIES": "4",
                    "APPARENT": "AIRLESS",
                    "ANG_FORMAT": "DEG",
                }
            )
            for r in table_rows(result):
                out.append(
                    {
                        "site": site,
                        "body": body,
                        "time": parse_time(r[0]),
                        "azimuthDeg": float(r[3]),
                        "elevationDeg": float(r[4]),
                    }
                )
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", default="2026-11-01")
    ap.add_argument("--stop", default="2028-01-01")
    ap.add_argument("--step", default="1h")
    args = ap.parse_args()

    series = fetch_series(args.start, args.stop, args.step)
    out = ROOT / "public" / "data" / "ephemeris.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(series, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}: {series['count']} samples, {out.stat().st_size / 1024:.0f} KiB")

    fixtures = fetch_fixtures()
    fx = ROOT / "src" / "domain" / "ephemeris" / "__fixtures__" / "horizons-topocentric.json"
    fx.parent.mkdir(parents=True, exist_ok=True)
    fx.write_text(json.dumps(fixtures, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {fx.relative_to(ROOT)}: {len(fixtures)} rows")


if __name__ == "__main__":
    main()
