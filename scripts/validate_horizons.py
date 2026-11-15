"""Sanity check: our terrain horizons + Horizons ephemeris vs PGDA's independent long-term averages.

For each site, compute the fraction of hourly samples (whole ephemeris, ~14 months) with the Sun /
Earth centre above our terrain horizon, and print it next to PGDA's 18.6-year average. The periods
differ, so numbers will not match exactly, but they should correlate strongly.

Usage: python scripts/validate_horizons.py   (stdlib only)
"""

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
R = 1737.4


def unit(lon, lat):
    lo, la = math.radians(lon), math.radians(lat)
    return (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))


def az_el(site, sub, dist_km=None):
    lo, la = math.radians(site["lon"]), math.radians(site["lat"])
    e = (-math.sin(lo), math.cos(lo), 0.0)
    n = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    u = (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))
    d = unit(*sub)
    v = d if dist_km is None else tuple(dist_km * d[i] - R * u[i] for i in range(3))
    norm = math.sqrt(sum(c * c for c in v))
    dot = lambda a, b: sum(a[i] * b[i] for i in range(3))  # noqa: E731
    return math.degrees(math.atan2(dot(v, e), dot(v, n))) % 360, math.degrees(math.asin(dot(v, u) / norm))


def horizon_at(mask, az):
    vals, step = mask["elevationDeg"], mask["stepDeg"]
    pos = (az - mask["startAzDeg"]) % 360 / step
    i0 = int(pos) % len(vals)
    t = pos - int(pos)
    return vals[i0] * (1 - t) + vals[(i0 + 1) % len(vals)] * t


eph = json.loads((ROOT / "public/data/ephemeris.json").read_text())
sites = json.loads((ROOT / "public/data/sites.json").read_text())["sites"]
rows = []
for s in sites:
    sun = earth = 0
    for i in range(0, eph["count"], 2):  # every 2 h is plenty
        az, el = az_el(s, (eph["subSolarLon"][i], eph["subSolarLat"][i]))
        sun += el > horizon_at(s["horizon"], az)
        az, el = az_el(s, (eph["subEarthLon"][i], eph["subEarthLat"][i]), eph["earthDistanceKm"][i])
        earth += el > horizon_at(s["horizon"], az)
    n = len(range(0, eph["count"], 2))
    rows.append((s["id"], 100 * sun / n, s["longTermSunPct"], 100 * earth / n, s["longTermEarthPct"]))

print(f"{'site':5s} {'sun ours':>9s} {'sun PGDA':>9s} {'earth ours':>11s} {'earth PGDA':>11s}")
for r in rows:
    print(f"{r[0]:5s} {r[1]:9.1f} {r[2]:9.1f} {r[3]:11.1f} {r[4]:11.1f}")


def corr(a, b):
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    return cov / math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))


mae = lambda a, b: sum(abs(x - y) for x, y in zip(a, b)) / len(a)  # noqa: E731
for name, i, j in (("sun", 1, 2), ("earth", 3, 4)):
    a, b = [r[i] for r in rows], [r[j] for r in rows]
    print(f"{name}: Pearson r = {corr(a, b):.2f}, mean abs diff = {mae(a, b):.1f} pts")
