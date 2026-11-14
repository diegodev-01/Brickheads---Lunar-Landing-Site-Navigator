"""Build the per-cell ANALYSIS GRID used for heatmaps, hard gates and top-3 recommendations.

Writes to public/data/grid/:
  grid.json   manifest: grid geometry, field list (dtype, scale, offset, unit, provenance, source),
              horizon encoding and a validation summary
  grid.bin.gz gzip of little-endian packed fields, one after another (offsets in the manifest);
              the browser inflates it with the native DecompressionStream

Grid: 500 m cells over the same 100 x 100 km polar-stereographic region as build_region.py
(200 x 200 = 40,000 cells, row 0 = top / +y). Per cell:
  elevation       mean LOLA height (m), from the 40 m DEM                                 DERIVED
  slopeMean/P95   mean and 95th-percentile slope (deg) of the 40 m slope map in the cell  MEASURED (LDSM) or
                                                                                         DERIVED (DEM fallback)
  roughness       std-dev of slope in the cell (deg), a roughness proxy                   DERIVED
  psrFraction     fraction of the cell in permanent shadow                                 MEASURED (LPSR)
  psrDistance     km from the cell to the nearest permanently shadowed 100 m pixel        DERIVED
  sunLongTerm     18.6-year mean solar visibility (%)                                      MEASURED (PGDA 69)
  earthLongTerm   18.6-year mean Earth visibility (%)                                      MEASURED (PGDA 69)
  horizon         90-bin terrain horizon mask at the cell centre (4 deg bins, see below)   DERIVED

Horizon masks are ray-cast here, offline, so the browser only does a per-cell lookup:
  * rays every 2 deg of azimuth (clockwise from local north), observer 2 m above the cell centre;
  * 40 m DEM, 40 m steps to 4 km then steps growing 1.5 %/step to 15 km; 320 m DEM with 2 %/step to 180 km;
  * lunar curvature drop d^2/2R; no refraction (airless);
  * each 4 deg bin keeps the MAX of the rays at its centre and +/-2 deg (conservative: never shows
    light that the finer mask would hide), quantised UP to 0.1 deg in uint8: el = -4 + 0.1*q (q 0..255).

Validation: mean Sun/Earth visibility over the whole bundled ephemeris (every 6 h), using these masks,
is correlated with PGDA's independent 18.6-yr maps and the result is stored in the manifest.

Usage:  scripts/.venv/Scripts/python scripts/build_grid.py   (shares scripts/.cache/ with build_region.py)
"""

from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_region as br  # noqa: E402  (shared readers, cache, constants)

CELL_M = 500.0
HALF = br.REGION["half_m"]
N = int(2 * HALF / CELL_M)  # 200
RAW_AZ_STEP = 2.0
BIN_DEG = 4.0
N_BINS = int(360 / BIN_DEG)  # 90
HZ_MIN, HZ_STEP = -4.0, 0.1
OUT = br.OUT / "grid"

# ------------------------------------------------------------------------- ray sample distances
def _distances() -> tuple[np.ndarray, np.ndarray]:
    near = list(np.arange(br.NEAR_RES, 4000.0 + 1, br.NEAR_RES))
    d = near[-1]
    while d < br.NEAR_MAX_D:
        d *= 1.015
        near.append(min(d, br.NEAR_MAX_D))
    far = [br.NEAR_MAX_D]
    d = br.NEAR_MAX_D
    while d < br.FAR_MAX_D:
        d *= 1.02
        far.append(d)
    return np.array(near), np.array(far)


_G: dict = {}


def _init(near: np.ndarray, far: np.ndarray) -> None:
    _G["near"] = br.Grid(near, br.NEAR_HALF, br.NEAR_RES)
    _G["far"] = br.Grid(far, br.FAR_HALF, br.FAR_RES)
    _G["d"] = _distances()


def _horizons(cells: np.ndarray) -> np.ndarray:
    """cells: (B, 2) x,y -> (B, 360/RAW_AZ_STEP) max terrain elevation angle (deg)."""
    near, far = _G["near"], _G["far"]
    d_near, d_far = _G["d"]
    az = np.deg2rad(np.arange(0.0, 360.0, RAW_AZ_STEP))
    out = np.empty((len(cells), len(az)), dtype=np.float32)
    for i, (x0, y0) in enumerate(cells):
        lon = math.atan2(x0, y0)
        north = np.array([math.sin(lon), math.cos(lon)])
        east = np.array([math.cos(lon), -math.sin(lon)])
        dirs = np.cos(az)[:, None] * north + np.sin(az)[:, None] * east
        h0 = float(near.sample(np.array([x0]), np.array([y0]))[0]) + br.OBSERVER_HEIGHT_M
        best = np.full(len(az), -90.0)
        for grid, d in ((near, d_near), (far, d_far)):
            px = x0 + dirs[:, 0:1] * d[None, :]
            py = y0 + dirs[:, 1:2] * d[None, :]
            h = grid.sample(px, py)
            ang = np.degrees(np.arctan2(h - h0 - d[None, :] ** 2 / (2 * br.R_MOON), d[None, :]))
            best = np.maximum(best, np.nanmax(ang, axis=1))
        out[i] = best
    return out


def pool_bins(raw: np.ndarray) -> np.ndarray:
    """(B, 180) at 2 deg -> (B, 90) at 4 deg: max of the ray at the bin centre and the two neighbours."""
    centre = raw[:, 0::2]
    left = np.roll(raw, 1, axis=1)[:, 0::2]
    right = raw[:, 1::2]
    return np.maximum(centre, np.maximum(left, right))


def encode_horizon(deg: np.ndarray) -> np.ndarray:
    q = np.ceil((np.nan_to_num(deg, nan=HZ_MIN) - HZ_MIN) / HZ_STEP - 1e-6)
    return np.clip(q, 0, 255).astype(np.uint8)


def decode_horizon(q: np.ndarray) -> np.ndarray:
    return HZ_MIN + HZ_STEP * q.astype(np.float32)


# ------------------------------------------------------------------------- helpers
def block(a: np.ndarray, k: int) -> np.ndarray:
    """(N*k, N*k) -> (N, N, k*k) blocks."""
    n = a.shape[0] // k
    return a.reshape(n, k, n, k).swapaxes(1, 2).reshape(n, n, k * k)


def upsample2(a: np.ndarray) -> np.ndarray:
    return np.repeat(np.repeat(a, 2, axis=0), 2, axis=1)


def cell_centres() -> tuple[np.ndarray, np.ndarray]:
    c = -HALF + (np.arange(N) + 0.5) * CELL_M
    xs, ys = np.meshgrid(c, c[::-1])  # row 0 = top (+y)
    return xs, ys


def body_visibility_fraction(
    xs: np.ndarray, ys: np.ndarray, hz: np.ndarray, eph: dict, body: str, every: int = 6
) -> np.ndarray:
    """Mean fraction of time the body's centre is above the (decoded, binned) horizon. Mirrors the TS model."""
    lon_k, lat_k = ("subSolarLon", "subSolarLat") if body == "sun" else ("subEarthLon", "subEarthLat")
    slon = np.deg2rad(np.array(eph[lon_k][::every]))
    slat = np.deg2rad(np.array(eph[lat_k][::every]))
    dist_km = np.array(eph["earthDistanceKm"][::every])
    bvec = np.stack([np.cos(slat) * np.cos(slon), np.cos(slat) * np.sin(slon), np.sin(slat)], axis=1)  # (T,3)
    if body == "earth":
        bvec = bvec * dist_km[:, None] * 1000.0

    flat_x, flat_y = xs.ravel(), ys.ravel()
    rho = np.hypot(flat_x, flat_y)
    lat = np.deg2rad(np.degrees(2 * np.arctan(rho / (2 * br.R_MOON))) - 90.0)
    lon = np.arctan2(flat_x, flat_y)
    up = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=1)  # (C,3)
    east = np.stack([-np.sin(lon), np.cos(lon), np.zeros_like(lon)], axis=1)
    north = np.cross(up, east)
    frac = np.zeros(len(flat_x))
    for i0 in range(0, len(flat_x), 2000):
        sl = slice(i0, i0 + 2000)
        v = bvec[None, :, :]
        if body == "earth":
            v = v - up[sl, None, :] * br.R_MOON
            v = v / np.linalg.norm(v, axis=2, keepdims=True)
        e = np.einsum("ctk,ck->ct", np.broadcast_to(v, (up[sl].shape[0],) + bvec.shape), up[sl])
        el = np.degrees(np.arcsin(np.clip(e, -1, 1)))
        az = np.degrees(
            np.arctan2(np.einsum("ctk,ck->ct", np.broadcast_to(v, el.shape + (3,)), east[sl]),
                       np.einsum("ctk,ck->ct", np.broadcast_to(v, el.shape + (3,)), north[sl]))
        ) % 360.0
        b = np.rint(az / BIN_DEG).astype(int) % N_BINS
        hzv = np.take_along_axis(hz[sl], b, axis=1)
        frac[sl] = (el > hzv).mean(axis=1)
    return frac.reshape(xs.shape)


# ------------------------------------------------------------------------- main
def main() -> None:
    br.CACHE.mkdir(parents=True, exist_ok=True)
    br.ensure_ca_bundle()
    OUT.mkdir(parents=True, exist_ok=True)

    print("1/5 reading rasters (cached after the first run)", flush=True)
    near = br.read_grid(f"/vsicurl/{br.PGDA90}LDEM_80S_20MPP_ADJ.TIF", br.NEAR_HALF, br.NEAR_RES, "ldem_near_40m", "average")
    far = br.read_grid(f"/vsicurl/{br.PGDA90}LDEM_80S_20MPP_ADJ.TIF", br.FAR_HALF, br.FAR_RES, "ldem_far_320m", "average")
    sun = br.read_grid(br.pds_product("AVGVISIB_85S_060M_201608"), HALF, br.DISPLAY_RES, "sun_100m")
    earth = br.read_grid(br.pds_product("AVGVISIB_85S_060M_201608_EARTH"), HALF, br.DISPLAY_RES, "earth_100m")
    psr = br.read_grid(br.pds_product("LPSR_85S_060M_201608"), HALF, br.DISPLAY_RES, "psr_100m", "nearest")
    sun_pct = sun * (100.0 if np.nanmax(sun) <= 1.0 else 1.0)
    earth_pct = earth * (100.0 if np.nanmax(earth) <= 1.0 else 1.0)
    psr_mask = np.nan_to_num(psr) > 0

    # 40 m slope over the region: PGDA's slope map if reachable (MEASURED), else from the DEM (DERIVED).
    try:
        slope40 = br.read_grid(f"/vsicurl/{br.PGDA90}LDSM_80S_20MPP_ADJ.TIF", HALF, br.NEAR_RES, "ldsm_40m", "average")
        if np.isnan(slope40).mean() > 0.05:
            raise RuntimeError("slope map mostly empty")
        slope_prov = ("measured", "high", "PGDA LDSM 20 m slope map, averaged to 40 m (Barker et al. 2023)")
    except Exception as e:  # PGDA rate limit / outage
        print(f"  slope map unavailable ({e}); computing slope from the 40 m DEM", flush=True)
        i0 = int((br.NEAR_HALF - HALF) / br.NEAR_RES)
        sub = near[i0 : i0 + int(2 * HALF / br.NEAR_RES) + 2, i0 : i0 + int(2 * HALF / br.NEAR_RES) + 2]
        dzdy, dzdx = np.gradient(sub, br.NEAR_RES)
        slope40 = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))[1:-1, 1:-1].astype(np.float32)
        slope_prov = ("derived", "medium", "Slope computed from the 40 m LOLA DEM (PGDA LDEM, Barker et al. 2023)")

    print("2/5 per-cell terrain statistics", flush=True)
    k20 = int(CELL_M / 20)  # 25 sub-pixels at 20 m after a 2x upsample of 40 m data
    sb = block(upsample2(slope40), k20)
    slope_mean = np.nanmean(sb, axis=2)
    slope_p95 = np.nanpercentile(sb, 95, axis=2)
    rough = np.nanstd(sb, axis=2)
    i0 = int((br.NEAR_HALF - HALF) / br.NEAR_RES)
    n40 = int(2 * HALF / br.NEAR_RES)
    elev = np.nanmean(block(upsample2(near[i0 : i0 + n40, i0 : i0 + n40]), k20), axis=2)
    k100 = int(CELL_M / br.DISPLAY_RES)
    psr_frac = block(psr_mask.astype(np.float32), k100).mean(axis=2)
    psr_dist_km = np.min(block(ndimage.distance_transform_edt(~psr_mask) * br.DISPLAY_RES / 1000.0, k100), axis=2)
    sun_lt = np.nanmean(block(sun_pct, k100), axis=2)
    earth_lt = np.nanmean(block(earth_pct, k100), axis=2)

    print(f"3/5 horizon masks for {N * N} cells", flush=True)
    xs, ys = cell_centres()
    cells = np.stack([xs.ravel(), ys.ravel()], axis=1)
    cached = br.CACHE / f"grid_horizons_{int(CELL_M)}m_raw.npy"
    if cached.exists():
        raw = np.load(cached)
    else:
        # Single process: ~2 min for 40k cells. (A process pool on Windows spends longer pickling the DEMs
        # to spawned workers than the work itself, and stalled in testing.)
        _init(near, far)
        chunks = np.array_split(cells, 100)
        parts = []
        for j, part in enumerate(chunks):
            parts.append(_horizons(part))
            if j % 10 == 0:
                print(f"  {j}/{len(chunks)} chunks", flush=True)
        raw = np.concatenate(parts)
        np.save(cached, raw)
    hz_q = encode_horizon(pool_bins(raw))
    hz = decode_horizon(hz_q)

    print("4/5 validating against PGDA long-term maps", flush=True)
    eph = json.loads((br.OUT / "ephemeris.json").read_text(encoding="utf-8"))
    sun_ours = body_visibility_fraction(xs, ys, hz, eph, "sun") * 100
    earth_ours = body_visibility_fraction(xs, ys, hz, eph, "earth") * 100
    valid = ~np.isnan(sun_lt) & ~np.isnan(earth_lt)
    validation = {
        "method": "Mean visibility over the bundled ephemeris (every 6 h) with these masks vs PGDA 18.6-yr maps",
        "sunR": round(float(np.corrcoef(sun_ours[valid], sun_lt[valid])[0, 1]), 3),
        "sunMeanAbsDiffPct": round(float(np.abs(sun_ours - sun_lt)[valid].mean()), 1),
        "earthR": round(float(np.corrcoef(earth_ours[valid], earth_lt[valid])[0, 1]), 3),
        "earthMeanAbsDiffPct": round(float(np.abs(earth_ours - earth_lt)[valid].mean()), 1),
    }
    print(f"  {validation}", flush=True)

    print("5/5 writing grid.bin + grid.json", flush=True)
    fields = [
        # id, array, dtype, scale, offset, unit, provenance kind, confidence, source
        ("elevation", elev, "i16", 1.0, 0.0, "m", "derived", "high", "Mean of PGDA LDEM 40 m in the cell (Barker et al. 2023)"),
        ("slopeMean", slope_mean, "u8", 0.2, 0.0, "deg", *slope_prov),
        ("slopeP95", slope_p95, "u8", 0.2, 0.0, "deg", slope_prov[0], slope_prov[1], "95th percentile of " + slope_prov[2]),
        ("roughness", rough, "u8", 0.1, 0.0, "deg", "derived", "medium", "Std-dev of 40 m slope within the cell (roughness proxy)"),
        ("psrFraction", psr_frac, "u8", 1 / 250, 0.0, "fraction", "measured", "high", "LOLA LPSR 60 m, PGDA product 69 (Mazarico et al. 2011)"),
        ("psrDistance", psr_dist_km, "u16", 0.01, 0.0, "km", "derived", "high", "Distance to nearest LPSR pixel (100 m)"),
        ("sunLongTerm", sun_lt, "u8", 0.5, 0.0, "%", "measured", "high", "LOLA AVGVISIB 60 m, PGDA product 69 (Mazarico et al. 2011)"),
        ("earthLongTerm", earth_lt, "u8", 0.5, 0.0, "%", "measured", "high", "LOLA AVGVISIB_EARTH 60 m, PGDA product 69 (Mazarico et al. 2011)"),
    ]
    np_types = {"u8": np.uint8, "u16": np.uint16, "i16": np.int16}
    nodata = {"u8": 255, "u16": 65535, "i16": -32768}
    blob, manifest_fields, offset = bytearray(), [], 0
    for fid, arr, dt, scale, off, unit, kind, conf, src in fields:
        info = np.iinfo(np_types[dt])
        q = np.round((arr - off) / scale)
        lo, hi = (info.min + 1, info.max) if dt == "i16" else (info.min, info.max - 1)  # reserve nodata
        q = np.where(np.isnan(q), nodata[dt], np.clip(q, lo, hi))
        b = q.astype(np.dtype(np_types[dt]).newbyteorder("<")).tobytes()
        manifest_fields.append(
            {"id": fid, "dtype": dt, "byteOffset": offset, "scale": scale, "offset": off, "nodata": nodata[dt], "unit": unit,
             "provenance": {"kind": kind, "confidence": conf, "source": src, "verified": True}}
        )
        blob += b
        offset += len(b)
        while offset % 4:  # keep typed-array views aligned
            blob.append(0)
            offset += 1
    manifest_fields.append(
        {"id": "horizon", "dtype": "u8", "byteOffset": offset, "scale": HZ_STEP, "offset": HZ_MIN, "nodata": None, "unit": "deg",
         "provenance": {"kind": "derived", "confidence": "medium", "verified": True,
                        "source": "Ray-cast from PGDA LDEM 40 m / 320 m (Barker et al. 2023) by scripts/build_grid.py"}}
    )
    # Delta along azimuth (mod 256) compresses ~35 % better: neighbouring bins are strongly correlated.
    hz_delta = (np.diff(hz_q.astype(np.int16), axis=1, prepend=0) % 256).astype(np.uint8)
    blob += hz_delta.tobytes()

    import gzip

    (OUT / "grid.bin.gz").write_bytes(gzip.compress(bytes(blob), compresslevel=9, mtime=0))
    stale = OUT / "grid.bin"
    if stale.exists():
        stale.unlink()
    manifest = {
        "version": 1,
        "cellSizeM": CELL_M,
        "cols": N,
        "rows": N,
        "extentM": [-HALF, -HALF, HALF, HALF],
        "rowOrder": "top-down (row 0 = max y)",
        "horizon": {"bins": N_BINS, "binDeg": BIN_DEG, "observerHeightM": br.OBSERVER_HEIGHT_M, "rayKm": br.FAR_MAX_D / 1000,
                    "encoding": "el_deg = offset + scale * q; bin k centred on azimuth k*binDeg; max-pooled over +/-2 deg",
                    "storage": "delta-az-u8: per cell, q[0] then q[k]-q[k-1] mod 256"},
        "file": "grid.bin.gz",
        "fields": manifest_fields,
        "validation": validation,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    (OUT / "grid.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(f"done: grid.bin.gz {(OUT / 'grid.bin.gz').stat().st_size / 1024:.0f} KiB ({len(blob) / 1024:.0f} KiB raw)")


if __name__ == "__main__":
    main()
