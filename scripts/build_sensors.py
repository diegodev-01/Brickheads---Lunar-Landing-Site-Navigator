"""Build per-cell SENSOR layers (500 m, same grid as build_grid.py) from real, verified datasets.

Writes public/data/sensors/{sensors.json, sensors.bin.gz} (same manifest/binary format as the grid).

Verified sources (requests made 2026-11-14, see docs/research/data-sources.md section 4):
  Radiometer   Diviner Polar Resource Product, south (Paige et al.; LRO-L-DLRE-5-PRP-V2.0)
               urn-nasa-pds-lro_diviner_derived1/data_derived_prp/dlre_prp_south.tab   605 MB ASCII
               -> annual mean / max bolometric temperature (K), depth to ice stability (m)
  SAR          Mini-RF global CPR mosaic, 128 ppd simple cylindrical (LRO-L-MRFLRO-5-GLOBAL-MOSAIC-V1)
               lromrf_1001/data/128ppd/global_cpr_128ppd_simp_0c.img   (only the south cap rows, ~62 MB range)
  Spectrometer Lunar Prospector GRS elemental abundances, 2 deg bins (Prettyman et al. 2006)
               lp-l-grs-5-elem-abundance-v1/lp_9001/data/lpgrs_high1_elem_abundance_2deg.tab   10 MB
               -> FeO, TiO2 wt% (one 2 deg bin is ~60 km: the whole region spans only a few bins)

Not used (could not be verified as browser-ready polar maps): LEND / LP-NS hydrogen maps, Diviner polar
rock abundance. The app replaces them with clearly labelled SIMULATED layers.

Python's TLS stack fails on pds-geosciences.wustl.edu from this machine, so downloads go through the
Windows curl.exe (schannel); on other systems plain `curl` is used.

Usage:  scripts/.venv/Scripts/python scripts/build_sensors.py
"""

from __future__ import annotations

import gzip
import json
import math
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_region as br  # noqa: E402

PDS = "https://pds-geosciences.wustl.edu"
PRP_URL = f"{PDS}/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp/dlre_prp_south.tab"
CPR_URL = f"{PDS}/lro/lro-l-mrflro-5-global-mosaic-v1/lromrf_1001/data/128ppd/global_cpr_128ppd_simp_0c.img"
GRS_URL = f"{PDS}/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/lpgrs_high1_elem_abundance_2deg.tab"

CELL_M = 500.0
HALF = br.REGION["half_m"]
N = int(2 * HALF / CELL_M)
LAT_CUT = -87.3  # every cell of the +/-50 km box (corners at ~70.7 km = 87.67 S) is poleward of this
OUT = br.OUT / "sensors"
UA = "lunar-landing-site-navigator/0.1"


def curl() -> str:
    exe = shutil.which("curl.exe") if sys.platform == "win32" else shutil.which("curl")
    if not exe:
        raise SystemExit("curl is required for PDS downloads")
    return exe


def cell_index(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    col = np.floor((x + HALF) / CELL_M).astype(np.int64)
    row = np.floor((HALF - y) / CELL_M).astype(np.int64)
    ok = (col >= 0) & (col < N) & (row >= 0) & (row < N)
    return np.where(ok, row * N + col, -1)


def lonlat_to_xy_np(lon_deg: np.ndarray, lat_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    rho = 2 * br.R_MOON * np.tan(np.deg2rad(45.0 + lat_deg / 2.0))
    return rho * np.sin(np.deg2rad(lon_deg)), rho * np.cos(np.deg2rad(lon_deg))


def bin_mean(idx: np.ndarray, values: np.ndarray) -> np.ndarray:
    ok = (idx >= 0) & np.isfinite(values)
    s = np.bincount(idx[ok], weights=values[ok], minlength=N * N)
    c = np.bincount(idx[ok], minlength=N * N)
    out = np.full(N * N, np.nan)
    out[c > 0] = s[c > 0] / c[c > 0]
    return out


def bin_median(idx: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Per-cell median (robust to the speckle/noise spikes common in radar data)."""
    ok = (idx >= 0) & np.isfinite(values)
    i, v = idx[ok], values[ok]
    order = np.lexsort((v, i))
    i, v = i[order], v[order]
    out = np.full(N * N, np.nan)
    if len(i) == 0:
        return out
    starts = np.flatnonzero(np.r_[True, i[1:] != i[:-1]])
    ends = np.r_[starts[1:], len(i)]
    mid_lo = v[starts + (ends - starts - 1) // 2]
    mid_hi = v[starts + (ends - starts) // 2]
    out[i[starts]] = 0.5 * (mid_lo + mid_hi)
    return out


def fill_small_gaps(a: np.ndarray, passes: int = 3) -> np.ndarray:
    """Fill isolated empty cells with the mean of their filled neighbours (source mesh is ~300 m)."""
    g = a.reshape(N, N).copy()
    for _ in range(passes):
        nan = np.isnan(g)
        if not nan.any():
            break
        p = np.pad(g, 1, constant_values=np.nan)
        neigh = np.stack([p[1 + dy : 1 + dy + N, 1 + dx : 1 + dx + N] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx])
        cnt = np.sum(~np.isnan(neigh), axis=0)
        mean = np.where(cnt > 0, np.nansum(neigh, axis=0) / np.maximum(cnt, 1), np.nan)
        g[nan] = mean[nan]
    return g.ravel()


# ----------------------------------------------------------------------------- Diviner PRP
def diviner_prp() -> dict[str, np.ndarray]:
    cached = br.CACHE / "diviner_prp_south_cap.npy"
    if not cached.exists():
        print(f"  streaming {PRP_URL} (605 MB, keeping rows south of {LAT_CUT} deg)", flush=True)
        keep: list[tuple[float, float, float, float, float]] = []
        proc = subprocess.Popen([curl(), "-s", "-f", "-A", UA, PRP_URL], stdout=subprocess.PIPE)
        assert proc.stdout
        header = True
        for raw in proc.stdout:
            if header:  # first record is the column header
                header = False
                continue
            parts = raw.split(b",")
            if len(parts) < 15:
                continue
            lat = float(parts[10])
            if lat > LAT_CUT:
                continue
            keep.append((float(parts[9]), lat, float(parts[12]), float(parts[13]), float(parts[14])))
        if proc.wait() != 0:
            raise SystemExit(f"curl failed for {PRP_URL}")
        np.save(cached, np.array(keep, dtype=np.float64))
    rows = np.load(cached)
    print(f"  Diviner PRP: {len(rows)} mesh triangles in the cap", flush=True)
    x, y = lonlat_to_xy_np(rows[:, 0] % 360.0, rows[:, 1])
    idx = cell_index(x, y)
    # ice_depth (label): depth where ice sublimates at 1 kg m^-2 per Gyr. 0 = stable AT the surface;
    # -999 = deeper than 2.8738 m. -1 is undocumented but occurs only where Tmax < 110 K (34k of 34k
    # such triangles have -1 or 0), so we read it as "stable at the surface" too (docs/decisions.md).
    raw = rows[:, 4]
    depth = np.where(raw == -1, 0.0, raw)
    depth = np.where(raw == -999, 3.0, depth)  # cap: "> 2.87 m"
    depth = np.where(depth < 0, np.nan, depth)
    surface_stable = (depth == 0).astype(float)
    return {
        "tempAvg": fill_small_gaps(bin_mean(idx, rows[:, 2])),
        "tempMax": fill_small_gaps(bin_mean(idx, rows[:, 3])),
        "iceDepth": fill_small_gaps(bin_mean(idx, depth)),
        "iceStableFraction": fill_small_gaps(bin_mean(idx, surface_stable)),
    }


# ----------------------------------------------------------------------------- Mini-RF CPR
def minirf_cpr() -> np.ndarray:
    lines, samples, res = 23040, 46080, 128.0
    first_line = int(math.floor(11520.5 - LAT_CUT * res)) - 1  # 0-based, include margin
    first_line = max(0, min(lines - 1, first_line))
    n_lines = lines - first_line
    cached = br.CACHE / f"minirf_cpr_cap_{first_line}.npy"
    if not cached.exists():
        start = first_line * samples * 4
        end = lines * samples * 4 - 1
        part = br.CACHE / "minirf_cpr_cap.part"
        print(f"  range-reading Mini-RF CPR lines {first_line}-{lines - 1} ({(end - start + 1) / 1e6:.0f} MB)", flush=True)
        subprocess.run([curl(), "-s", "-f", "-A", UA, "-r", f"{start}-{end}", "-o", str(part), CPR_URL], check=True)
        a = np.fromfile(part, dtype="<f4").reshape(n_lines, samples)
        np.save(cached, a)
        part.unlink()
    a = np.load(cached).astype(np.float64)
    # CPR is physically ~0-2; much larger values are low-SNR noise (common in polar shadow). Drop > 3.
    a[(a < -1e30) | (a > 3.0) | (a < 0)] = np.nan
    line = first_line + np.arange(a.shape[0])
    lat = (11520.5 - (line + 1)) / res  # pixel centres, 1-based projection offset
    lon = (np.arange(samples) + 1 - 23040.5) / res
    lon2, lat2 = np.meshgrid(lon, lat)
    sel = lat2 <= LAT_CUT
    x, y = lonlat_to_xy_np(lon2[sel] % 360.0, lat2[sel])
    idx = cell_index(x, y)
    cpr = bin_median(idx, a[sel])
    print(f"  Mini-RF CPR: {np.isfinite(cpr).mean() * 100:.0f} % of cells covered, median {np.nanmedian(cpr):.2f}", flush=True)
    return cpr


# ----------------------------------------------------------------------------- LP GRS
def lp_grs() -> dict[str, np.ndarray]:
    path = br.CACHE / "lpgrs_high1_elem_abundance_2deg.tab"
    if not path.exists():
        print(f"  downloading {GRS_URL}", flush=True)
        subprocess.run([curl(), "-s", "-f", "-A", UA, "-o", str(path), GRS_URL], check=True)
    bins = []
    for line in path.read_text(encoding="ascii", errors="ignore").splitlines():
        p = line.split()
        if len(p) < 13:
            continue
        try:
            minlat, maxlat, minlon, maxlon = (float(v) for v in p[1:5])
            tio2, feo = float(p[11]), float(p[12])
        except ValueError:
            continue
        if minlat <= -85.0:
            # Table values are weight FRACTIONS; longitudes are in [-180, 180] (bin 0 spans all of them).
            bins.append((minlat, maxlat, minlon, maxlon, 100.0 * feo, 100.0 * tio2))
    print(f"  LP GRS: {len(bins)} 2-deg bins south of 85 S", flush=True)
    c = -HALF + (np.arange(N) + 0.5) * CELL_M
    xs, ys = np.meshgrid(c, c[::-1])
    rho = np.hypot(xs, ys).ravel()
    lat = np.degrees(2 * np.arctan(rho / (2 * br.R_MOON))) - 90.0
    lon = (np.degrees(np.arctan2(xs.ravel(), ys.ravel())) + 180.0) % 360.0 - 180.0  # [-180, 180)
    feo = np.full(N * N, np.nan)
    tio2 = np.full(N * N, np.nan)
    for minlat, maxlat, minlon, maxlon, f, t in bins:
        m = (lat >= minlat) & (lat < maxlat) & (lon >= minlon) & (lon < maxlon + (1e-9 if maxlon >= 180 else 0))
        feo[m], tio2[m] = f, t
    return {"feo": feo, "tio2": tio2}


# ----------------------------------------------------------------------------- write
def main() -> None:
    br.CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    print("1/3 Diviner PRP (radiometer)", flush=True)
    prp = diviner_prp()
    print("2/3 Mini-RF CPR (SAR)", flush=True)
    cpr = minirf_cpr()
    print("3/3 LP GRS (spectrometer)", flush=True)
    grs = lp_grs()

    P_DIV = "Diviner Polar Resource Product, south (Paige et al. 2010; LRO-L-DLRE-5-PRP-V2.0), binned to 500 m"
    P_CPR = "LRO Mini-RF S-band (12.6 cm) global CPR mosaic, 128 ppd (LRO-L-MRFLRO-5-GLOBAL-MOSAIC-V1), 2009–2010"
    P_GRS = "Lunar Prospector GRS elemental abundance, 2° bins (~60 km) (Prettyman et al. 2006)"
    fields = [
        ("tempAvg", prp["tempAvg"], "u16", 0.01, 0.0, "K", "measured", "high", P_DIV + " — annual mean bolometric T"),
        ("tempMax", prp["tempMax"], "u16", 0.01, 0.0, "K", "measured", "high", P_DIV + " — annual max bolometric T"),
        ("iceDepth", prp["iceDepth"], "u16", 0.001, 0.0, "m", "derived", "medium",
         P_DIV + " — depth of water-ice stability (1 kg m⁻² Gyr⁻¹ sublimation), capped at 3 m = deeper than 2.87 m"),
        ("iceStableFraction", prp["iceStableFraction"], "u8", 1 / 250, 0.0, "fraction", "derived", "medium",
         P_DIV + " — share of the cell where water ice is stable AT the surface (cold trap)"),
        ("cpr", cpr, "u16", 0.001, 0.0, "ratio", "measured", "medium", P_CPR),
        ("feo", grs["feo"], "u16", 0.01, 0.0, "wt%", "measured", "low", P_GRS + " — FeO"),
        ("tio2", grs["tio2"], "u16", 0.01, 0.0, "wt%", "measured", "low", P_GRS + " — TiO2"),
    ]
    for f in fields:
        a = f[1]
        print(f"  {f[0]:18s} cover={np.isfinite(a).mean() * 100:5.1f}%  min={np.nanmin(a):9.3f}  max={np.nanmax(a):9.3f}", flush=True)

    np_types = {"u8": np.uint8, "u16": np.uint16}
    nodata = {"u8": 255, "u16": 65535}
    blob, manifest_fields, offset = bytearray(), [], 0
    for fid, arr, dt, scale, off, unit, kind, conf, src in fields:
        info = np.iinfo(np_types[dt])
        q = np.round((arr - off) / scale)
        q = np.where(np.isnan(q), nodata[dt], np.clip(q, info.min, info.max - 1))
        b = q.astype(np.dtype(np_types[dt]).newbyteorder("<")).tobytes()
        manifest_fields.append({"id": fid, "dtype": dt, "byteOffset": offset, "scale": scale, "offset": off,
                                "nodata": nodata[dt], "unit": unit,
                                "provenance": {"kind": kind, "confidence": conf, "source": src, "verified": True}})
        blob += b
        offset += len(b)
        while offset % 4:
            blob.append(0)
            offset += 1
    (OUT / "sensors.bin.gz").write_bytes(gzip.compress(bytes(blob), compresslevel=9, mtime=0))
    manifest = {
        "version": 1, "cellSizeM": CELL_M, "cols": N, "rows": N, "extentM": [-HALF, -HALF, HALF, HALF],
        "file": "sensors.bin.gz", "fields": manifest_fields,
        "sources": {"diviner": PRP_URL, "minirf": CPR_URL, "lpgrs": GRS_URL},
        "unverified": ["LEND / LP-NS hydrogen maps (only raw EDR/RDR found)",
                       "Diviner polar rock abundance (only cylindrical GDR L3 / GHRM found)"],
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    (OUT / "sensors.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(f"done: sensors.bin.gz {(OUT / 'sensors.bin.gz').stat().st_size / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
