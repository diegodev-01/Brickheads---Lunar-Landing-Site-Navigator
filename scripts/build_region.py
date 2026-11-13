"""Build the demo region dataset (map layers + candidate sites with terrain horizons).

Reads REAL NASA data and writes small, browser-ready files to public/data/:

  region.json        region metadata, layer legends, IAU feature labels, attribution
  sites.json         candidate + reference sites: slope, roughness, PSR distance, long-term
                     illumination/Earth visibility, and a 720-bin terrain horizon mask
  layers/*.png       1000x1000 px (100 m/px) raster layers in south polar stereographic

Sources (see docs/research/data-sources.md):
  PGDA product 90  LDEM/LDSM 20 m COGs (Barker et al. 2023)  -> windowed HTTP reads, no full download
  PGDA product 69  AVGVISIB sun/Earth + LPSR 60 m (Mazarico et al. 2011) -> downloaded once (~60 MB)
  IAU Gazetteer    feature names/centres

Usage:  scripts/.venv/Scripts/python scripts/build_region.py   (results cached in scripts/.cache/)
"""

from __future__ import annotations

import json
import math
import os
import re
import ssl
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache"
OUT = ROOT / "public" / "data"

R_MOON = 1_737_400.0  # m, reference sphere used by the LOLA polar products
PROJ4 = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"

REGION = {"id": "shackleton-de-gerlache", "name": "Shackleton – de Gerlache corridor", "half_m": 50_000}
DISPLAY_RES = 100.0  # m/px for map layers
NEAR_RES, NEAR_HALF = 40.0, 64_000.0  # near-field DEM for horizons
FAR_RES, FAR_HALF = 320.0, 235_000.0  # far-field DEM for horizons
NEAR_MAX_D, FAR_MAX_D = 15_000.0, 180_000.0  # ray lengths (m)
HORIZON_STEP_DEG = 0.5
OBSERVER_HEIGHT_M = 2.0  # assumed solar-panel / antenna height above the surface

PGDA90 = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"
# PGDA product 69 files, from the LOLA PDS data node (same products as the PGDA GeoTIFFs; PGDA
# itself rate-limits with HTTP 503 after many range reads).
PDS_ILLUM = "https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/"
GAZETTEER = "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.kmz"
GDAL_ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".TIF,.tif",
    GDAL_HTTP_MAX_RETRY="5",
    GDAL_HTTP_RETRY_DELAY="2",
    GDAL_HTTP_TIMEOUT="120",
    # PGDA's server intermittently answers a range request with 0 bytes. Fetch ranges one by one and
    # do not cache responses, so a retry really goes back to the network.
    GDAL_HTTP_MULTIRANGE="SERIAL",
    GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="NO",
    CPL_VSIL_CURL_NON_CACHED="/vsicurl/https://pgda.gsfc.nasa.gov/",
)


def with_retry(fn, what: str, attempts: int = 6):
    """Call fn(), retrying with backoff on I/O errors (flaky remote COG reads)."""
    import time

    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # rasterio raises several error types for HTTP failures
            if i == attempts - 1:
                raise
            wait = 2 * (i + 1)
            print(f"    retry {i + 1}/{attempts - 1} for {what} in {wait}s ({type(e).__name__})", flush=True)
            time.sleep(wait)


# ----------------------------------------------------------------------------- network helpers
def ensure_ca_bundle() -> None:
    """GDAL's curl does not read the Windows trust store; export it so TLS verification still works."""
    if os.environ.get("CURL_CA_BUNDLE") or sys.platform != "win32":
        return
    pem = CACHE / "windows-ca.pem"
    if not pem.exists():
        certs = ssl.create_default_context().get_ca_certs(binary_form=True)
        pem.write_text("".join(ssl.DER_cert_to_PEM_cert(c) for c in certs), encoding="ascii")
    os.environ["CURL_CA_BUNDLE"] = str(pem)


def download(url: str) -> Path:
    dest = CACHE / url.rsplit("/", 1)[1]
    if not dest.exists():
        print(f"  downloading {url}", flush=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        req = urllib.request.Request(url, headers={"User-Agent": "lunar-landing-site-navigator/0.1"})
        with urllib.request.urlopen(req, timeout=600) as r, open(tmp, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
        tmp.rename(dest)
    return dest


def pds_product(stem: str) -> str:
    """Download a PDS3 IMG + detached label; GDAL opens the .LBL (projection + scaling from the label)."""
    download(PDS_ILLUM + stem + ".IMG")
    return str(download(PDS_ILLUM + stem + ".LBL"))


def read_grid(src: str, half_m: float, res: float, cache_name: str, resampling: str = "bilinear") -> np.ndarray:
    """Read a square window centred on the pole, resampled to `res` m/px, into float32 (cached)."""
    cached = CACHE / f"{cache_name}.npy"
    if cached.exists():
        return np.load(cached)
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import reproject
    from rasterio.transform import from_origin

    from rasterio.windows import from_bounds

    n = int(round(2 * half_m / res))
    dst = np.full((n, n), np.nan, dtype=np.float32)
    dst_transform = from_origin(-half_m, half_m, res, res)
    print(f"  reading {src} -> {n}x{n} @ {res:g} m", flush=True)
    with rasterio.Env(**GDAL_ENV):
        with rasterio.open(src) as ds:
            scale, offset = (ds.scales or (1.0,))[0] or 1.0, (ds.offsets or (0.0,))[0] or 0.0
            same_grid = ds.crs.to_proj4().replace(" +no_defs=True", "") in PROJ4 and abs(ds.res[0] - 20) < 1e-6
            if same_grid:
                # Remote COG on our exact projection: a windowed read with out_shape lets GDAL pick
                # an overview, so only the needed (decimated) tiles are fetched over HTTP.
                # Read in chunks so one flaky HTTP response only costs a small retry.
                chunk = 400
                for r0 in range(0, n, chunk):
                    for c0 in range(0, n, chunk):
                        h, w = min(chunk, n - r0), min(chunk, n - c0)
                        x0, y1 = -half_m + c0 * res, half_m - r0 * res
                        win = from_bounds(x0, y1 - h * res, x0 + w * res, y1, ds.transform)
                        try:
                            dst[r0 : r0 + h, c0 : c0 + w] = with_retry(
                                lambda win=win, h=h, w=w: ds.read(
                                    1, window=win, out_shape=(h, w), resampling=getattr(Resampling, resampling)
                                ),
                                f"chunk {r0},{c0}",
                                attempts=4,
                            )
                        except Exception as e:
                            # Some tiles (e.g. corners outside the 80S data circle) never come back.
                            # Leave them NaN: horizon rays use nanmax, layers render NaN transparent.
                            print(f"    WARNING chunk {r0},{c0} left empty ({type(e).__name__})", flush=True)
            else:
                reproject(
                    source=rasterio.band(ds, 1),
                    destination=dst,
                    dst_transform=dst_transform,
                    dst_crs=ds.crs,
                    dst_nodata=np.nan,
                    resampling=getattr(Resampling, resampling),
                )
            if ds.nodata is not None and not np.isnan(ds.nodata):
                dst[dst == ds.nodata] = np.nan
            dst = dst * scale + offset
    np.save(cached, dst)
    return dst


# ----------------------------------------------------------------------------- geometry
def xy_to_lonlat(x: float, y: float) -> tuple[float, float]:
    rho = math.hypot(x, y)
    lat = math.degrees(2 * math.atan(rho / (2 * R_MOON))) - 90.0
    lon = math.degrees(math.atan2(x, y)) % 360.0
    return lon, lat


def lonlat_to_xy(lon: float, lat: float) -> tuple[float, float]:
    rho = 2 * R_MOON * math.tan(math.radians(45.0 + lat / 2.0))
    return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))


class Grid:
    """A north-up raster centred on the pole: row 0 is +y (top)."""

    def __init__(self, data: np.ndarray, half_m: float, res: float):
        self.data, self.half, self.res = data, half_m, res

    def rc(self, x, y):
        return (self.half - np.asarray(y)) / self.res - 0.5, (np.asarray(x) + self.half) / self.res - 0.5

    def sample(self, x, y, order: int = 1) -> np.ndarray:
        r, c = self.rc(x, y)
        return ndimage.map_coordinates(self.data, [np.ravel(r), np.ravel(c)], order=order, mode="nearest").reshape(
            np.shape(x)
        )


def horizon_mask(x0: float, y0: float, near: Grid, far: Grid) -> np.ndarray:
    """Max terrain elevation angle (deg) per azimuth, measured clockwise from local north.

    At a south-polar site local north points AWAY from the pole and east is clockwise on the map.
    Terrain height is corrected for lunar curvature (drop = d^2 / 2R); no atmosphere/refraction.
    """
    lon = math.atan2(x0, y0)
    north = np.array([math.sin(lon), math.cos(lon)])
    east = np.array([math.cos(lon), -math.sin(lon)])
    if x0 == 0 and y0 == 0:  # exactly at the pole: pick lon 0 frame
        north, east = np.array([0.0, 1.0]), np.array([1.0, 0.0])

    az = np.deg2rad(np.arange(0.0, 360.0, HORIZON_STEP_DEG))
    dirs = np.cos(az)[:, None] * north + np.sin(az)[:, None] * east  # (A, 2)
    h0 = float(near.sample(np.array([x0]), np.array([y0]))[0]) + OBSERVER_HEIGHT_M

    best = np.full(len(az), -90.0)
    for grid, d in (
        (near, np.arange(NEAR_RES, NEAR_MAX_D, NEAR_RES)),
        (far, np.arange(NEAR_MAX_D, FAR_MAX_D, FAR_RES)),
    ):
        px = x0 + dirs[:, 0:1] * d[None, :]
        py = y0 + dirs[:, 1:2] * d[None, :]
        h = grid.sample(px, py)
        ang = np.degrees(np.arctan2(h - h0 - d[None, :] ** 2 / (2 * R_MOON), d[None, :]))
        best = np.maximum(best, np.nanmax(ang, axis=1))
    return best


def site_slope_windows(sites: list, near: "Grid") -> tuple[list[tuple[np.ndarray, float]], str]:
    """Slope (deg) windows of +/-220 m around each site, plus a description of the method.

    Preferred: PGDA LDSM 20 m slope map (remote COG). If PGDA is unreachable, fall back to slope
    computed from the (already cached) 40 m LOLA DEM for ALL sites, so the ranking stays consistent.
    """
    cached = CACHE / "site_slopes.npz"
    if cached.exists():
        z = np.load(cached, allow_pickle=True)
        return list(z["windows"]), str(z["source"])
    import rasterio
    from rasterio.windows import from_bounds

    out: list[tuple[np.ndarray, float]] = []
    try:
        with rasterio.Env(**GDAL_ENV):
            with rasterio.open(f"/vsicurl/{PGDA90}LDSM_80S_20MPP_ADJ.TIF") as ds:
                for i, (x, y, *_rest) in enumerate(sites):
                    w = with_retry(
                        lambda x=x, y=y: ds.read(1, window=from_bounds(x - 220, y - 220, x + 220, y + 220, ds.transform)),
                        f"slope window site {i + 1}",
                        attempts=3,
                    )
                    out.append((w, 20.0))
        source = "PGDA LDSM 20 m slope map"
    except Exception as e:  # PGDA down / rate limited
        print(f"  PGDA slope map unavailable ({type(e).__name__}); using slope from the 40 m LOLA DEM")
        out = []
        for x, y, *_rest in sites:
            n = 7  # +/-6 px at 40 m (+ 1 px margin for the gradient)
            xs = x + np.arange(-n, n + 1) * NEAR_RES
            ys = y - np.arange(-n, n + 1) * NEAR_RES
            gx, gy = np.meshgrid(xs, ys)
            z = near.sample(gx, gy)
            dzdy, dzdx = np.gradient(z, NEAR_RES)
            slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))[1:-1, 1:-1]
            out.append((slope, NEAR_RES))
        source = "computed from the 40 m LOLA DEM (PGDA LDEM, overview)"
    np.savez(cached, windows=np.array(out, dtype=object), source=source)
    return out, source


# ----------------------------------------------------------------------------- colour maps
def ramp(values: np.ndarray, vmin: float, vmax: float, stops: list[tuple[float, str]], alpha: float = 1.0) -> np.ndarray:
    t = np.nan_to_num(np.clip((values - vmin) / (vmax - vmin), 0, 1))
    pos = np.array([s[0] for s in stops])
    cols = np.array([[int(c[i : i + 2], 16) for i in (1, 3, 5)] for _, c in stops], dtype=float)
    rgba = np.zeros(values.shape + (4,), dtype=np.uint8)
    for ch in range(3):
        rgba[..., ch] = np.interp(t, pos, cols[:, ch]).astype(np.uint8)
    rgba[..., 3] = np.where(np.isnan(values), 0, int(alpha * 255))
    return rgba


def save_png(rgba: np.ndarray, name: str) -> str:
    path = OUT / "layers" / f"{name}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.fromarray(rgba, mode="RGBA")
    if (rgba[..., 0] == rgba[..., 1]).all() and (rgba[..., 1] == rgba[..., 2]).all() and (rgba[..., 3] == 255).all():
        img = img.convert("L")  # grayscale hillshade
    else:
        img = img.quantize(colors=64, method=Image.Quantize.FASTOCTREE)  # small palette PNG
    img.save(path, optimize=True)
    return f"/data/layers/{name}.png"


def hillshade(dem: np.ndarray, res: float, az_deg: float = 315.0, alt_deg: float = 30.0) -> np.ndarray:
    dy, dx = np.gradient(np.nan_to_num(dem, nan=np.nanmean(dem)), res)
    slope = np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    az, alt = math.radians(az_deg), math.radians(alt_deg)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(shade, 0, 1)


# ----------------------------------------------------------------------------- gazetteer
def gazetteer_features(half: float) -> list[dict]:
    kml = zipfile.ZipFile(download(GAZETTEER)).read("MOON_nomenclature_center_pts.kml").decode("utf-8", "ignore")
    feats = []
    for pm in re.findall(r"<Placemark[^>]*>(.*?)</Placemark>", kml, re.S):
        get = lambda f: (m.group(1) if (m := re.search(rf'name="{f}">([^<]*)<', pm)) else "")  # noqa: E731
        try:
            lat, lon = float(get("center_lat")), float(get("center_lon"))
        except ValueError:
            continue
        if lat > -86:
            continue
        x, y = lonlat_to_xy(lon, lat)
        if abs(x) <= half and abs(y) <= half:
            feats.append(
                {
                    "name": get("clean_name"),
                    "lat": lat,
                    "lon": lon % 360,
                    "x": round(x),
                    "y": round(y),
                    "diameterKm": round(float(get("diameter") or 0), 2),
                    "type": get("type"),
                }
            )
    return sorted(feats, key=lambda f: -f["diameterKm"])


def describe_location(x: float, y: float, feats: list[dict]) -> str:
    craters = [f for f in feats if f["diameterKm"] >= 3]
    best, best_d = None, 1e18
    for f in craters:
        d = math.hypot(x - f["x"], y - f["y"]) / 1000
        rim = abs(d - f["diameterKm"] / 2)
        if rim < best_d:
            best, best_d = (f, d), rim
    if best and best_d < 2.5:
        return f"{best[0]['name']} rim"
    f = min(craters, key=lambda f: math.hypot(x - f["x"], y - f["y"]))
    return f"near {f['name']}"


# ----------------------------------------------------------------------------- main
def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    ensure_ca_bundle()
    half = REGION["half_m"]
    n = int(2 * half / DISPLAY_RES)

    print("1/5 reading rasters")
    dem_disp = read_grid(f"/vsicurl/{PGDA90}LDEM_80S_20MPP_ADJ.TIF", half, DISPLAY_RES, "ldem_100m", "average")
    slope_disp = read_grid(f"/vsicurl/{PGDA90}LDSM_80S_20MPP_ADJ.TIF", half, DISPLAY_RES, "ldsm_100m", "average")
    near = Grid(read_grid(f"/vsicurl/{PGDA90}LDEM_80S_20MPP_ADJ.TIF", NEAR_HALF, NEAR_RES, "ldem_near_40m", "average"), NEAR_HALF, NEAR_RES)
    far = Grid(read_grid(f"/vsicurl/{PGDA90}LDEM_80S_20MPP_ADJ.TIF", FAR_HALF, FAR_RES, "ldem_far_320m", "average"), FAR_HALF, FAR_RES)
    sun = read_grid(pds_product("AVGVISIB_85S_060M_201608"), half, DISPLAY_RES, "sun_100m")
    earth = read_grid(pds_product("AVGVISIB_85S_060M_201608_EARTH"), half, DISPLAY_RES, "earth_100m")
    psr = read_grid(pds_product("LPSR_85S_060M_201608"), half, DISPLAY_RES, "psr_100m", "nearest")
    for name, a in (("dem", dem_disp), ("slope", slope_disp), ("sun", sun), ("earth", earth), ("psr", psr)):
        print(f"  {name:6s} min={np.nanmin(a):9.3f} max={np.nanmax(a):9.3f} nan={np.isnan(a).mean():.3f}")
    # PGDA-69 visibility maps are stored as fractions (0-1) or percent depending on version: normalise to %.
    sun_pct = sun * (100.0 if np.nanmax(sun) <= 1.0 else 1.0)
    earth_pct = earth * (100.0 if np.nanmax(earth) <= 1.0 else 1.0)
    psr_mask = np.nan_to_num(psr) > 0

    print("2/5 rendering layers")
    shade = hillshade(dem_disp, DISPLAY_RES)
    gray = (40 + 200 * shade).astype(np.uint8)
    layers = [
        {
            "id": "hillshade", "label": "Terrain (hillshade)", "url": save_png(np.dstack([gray, gray, gray, np.full_like(gray, 255)]), "hillshade"),
            "legend": None, "provenance": "derived", "source": "Computed from PGDA LDEM 20 m (Barker et al. 2023)",
        },
        {
            "id": "slope", "label": "Slope", "url": save_png(ramp(slope_disp, 0, 25, [(0, "#1a9850"), (0.32, "#d9ef8b"), (0.6, "#fdae61"), (1, "#a50026")]), "slope"),
            "legend": {"min": 0, "max": 25, "unit": "°", "stops": ["#1a9850", "#d9ef8b", "#fdae61", "#a50026"]},
            "provenance": "real", "source": "PGDA LDSM 20 m slope, averaged to 100 m (Barker et al. 2023)",
        },
        {
            "id": "sun", "label": "Sunlight (18.6-yr avg)", "url": save_png(ramp(sun_pct, 0, 100, [(0, "#0b0b2b"), (0.35, "#7a1f5c"), (0.7, "#f2711c"), (1, "#fff3a0")]), "sun"),
            "legend": {"min": 0, "max": 100, "unit": "%", "stops": ["#0b0b2b", "#7a1f5c", "#f2711c", "#fff3a0"]},
            "provenance": "real", "source": "LOLA AVGVISIB 60 m, PGDA product 69 (Mazarico et al. 2011)",
        },
        {
            "id": "earth", "label": "Earth visibility (18.6-yr avg)", "url": save_png(ramp(earth_pct, 0, 100, [(0, "#0b0b2b"), (0.4, "#1d4e89"), (0.75, "#2fa4d9"), (1, "#c8f4ff")]), "earth"),
            "legend": {"min": 0, "max": 100, "unit": "%", "stops": ["#0b0b2b", "#1d4e89", "#2fa4d9", "#c8f4ff"]},
            "provenance": "real", "source": "LOLA AVGVISIB_EARTH 60 m, PGDA product 69 (Mazarico et al. 2011)",
        },
        {
            "id": "psr", "label": "Permanent shadow (PSR)", "url": save_png(ramp(np.where(psr_mask, 1.0, np.nan), 0, 1, [(0, "#4cc9f0"), (1, "#4cc9f0")], 0.75), "psr"),
            "legend": {"min": 0, "max": 1, "unit": "", "stops": ["#4cc9f0", "#4cc9f0"]},
            "provenance": "real", "source": "LOLA LPSR 60 m, PGDA product 69 (Mazarico et al. 2011)",
        },
    ]

    print("3/5 selecting candidate sites")
    feats = gazetteer_features(half)
    psr_dist_km = ndimage.distance_transform_edt(~psr_mask) * DISPLAY_RES / 1000.0
    score = np.nan_to_num(sun_pct) + 0.25 * np.nan_to_num(earth_pct)
    smooth_slope = ndimage.uniform_filter(np.nan_to_num(slope_disp, nan=90), size=3)
    score[(smooth_slope > 8) | psr_mask] = -1
    margin = int(3000 / DISPLAY_RES)
    score[:margin], score[-margin:], score[:, :margin], score[:, -margin:] = -1, -1, -1, -1
    picks: list[tuple[int, int]] = []
    order = np.argsort(score, axis=None)[::-1]
    min_sep_px = 4000 / DISPLAY_RES
    for idx in order:
        r, c = divmod(int(idx), n)
        if score[r, c] < 0 or len(picks) >= 18:
            break
        if all(math.hypot(r - pr, c - pc) >= min_sep_px for pr, pc in picks):
            picks.append((r, c))
    candidates = [(-half + (c + 0.5) * DISPLAY_RES, half - (r + 0.5) * DISPLAY_RES, "candidate", None) for r, c in picks]
    references = []
    for name in ("Shackleton", "de Gerlache", "Spudis"):
        f = next((f for f in feats if f["name"] == name), None)
        if f:
            references.append((float(f["x"]), float(f["y"]), "reference", f"{name} crater floor"))

    print("4/5 per-site metrics + horizons")
    all_sites = candidates + references
    slope_windows, slope_source = site_slope_windows(all_sites, near)
    print(f"  slope source: {slope_source}")

    sites = []
    for i, (x, y, kind, label) in enumerate(all_sites):
        win, px = slope_windows[i]
        k = win.shape[0]
        yy, xx = np.mgrid[0:k, 0:k]
        dist = np.hypot(yy - (k - 1) / 2, xx - (k - 1) / 2) * px
        s100, s200 = win[dist <= 100], win[dist <= 200]
        lon, lat = xy_to_lonlat(x, y)
        rr, cc = int((half - y) / DISPLAY_RES), int((x + half) / DISPLAY_RES)
        mask = horizon_mask(x, y, near, far)
        sites.append(
            {
                "id": f"S{i + 1:02d}" if kind == "candidate" else f"R{i - len(candidates) + 1}",
                "name": label or describe_location(x, y, feats),
                "kind": kind,
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "x": round(x),
                "y": round(y),
                "elevationM": round(float(near.sample(np.array([x]), np.array([y]))[0]), 1),
                "slopeMeanDeg": round(float(np.nanmean(s100)), 2),
                "slopeMaxDeg": round(float(np.nanmax(s100)), 2),
                "roughnessDeg": round(float(np.nanstd(s200)), 2),
                "psrDistanceKm": round(float(psr_dist_km[rr, cc]), 2),
                "inPsr": bool(psr_mask[rr, cc]),
                "longTermSunPct": round(float(sun_pct[rr, cc]), 1),
                "longTermEarthPct": round(float(earth_pct[rr, cc]), 1),
                "horizon": {"startAzDeg": 0, "stepDeg": HORIZON_STEP_DEG, "elevationDeg": [round(float(v), 2) for v in mask]},
                "slopeSource": slope_source,
                "provenance": "derived",
            }
        )
        print(f"  {sites[-1]['id']:4s} {sites[-1]['name']:28s} slope={sites[-1]['slopeMeanDeg']:5.1f} sun={sites[-1]['longTermSunPct']:5.1f}% earth={sites[-1]['longTermEarthPct']:5.1f}% hz_max={mask.max():5.2f}")

    print("5/5 writing JSON")
    region = {
        "id": REGION["id"],
        "name": REGION["name"],
        "projection": {"code": "MOON:SP", "proj4": PROJ4, "radiusM": R_MOON},
        "extentM": [-half, -half, half, half],
        "displayResolutionM": DISPLAY_RES,
        "layers": layers,
        "features": feats,
        "assumptions": {"observerHeightM": OBSERVER_HEIGHT_M, "horizonStepDeg": HORIZON_STEP_DEG, "horizonRayKm": FAR_MAX_D / 1000},
        "attribution": [
            "Topography/slope: NASA GSFC PGDA, LOLA south-pole DEMs, Barker et al. (2023) PSJ 4:183, doi:10.3847/PSJ/acf3e1",
            "Illumination/Earth visibility/PSR: LOLA team via PDS / NASA GSFC PGDA, Mazarico et al. (2011) Icarus 211:1066, doi:10.1016/j.icarus.2010.10.030",
            "Ephemeris: NASA/JPL Horizons System (DE441)",
            "Feature names: IAU/USGS Gazetteer of Planetary Nomenclature",
        ],
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    (OUT / "region.json").write_text(json.dumps(region, indent=1), encoding="utf-8")
    (OUT / "sites.json").write_text(json.dumps({"provenance": "derived", "sites": sites}, separators=(",", ":")), encoding="utf-8")
    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"done: {len(sites)} sites, public/data total {total / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
