# Data sources for the Lunar Landing Site Navigator

Research for NASA Space Apps Challenge 2026, _Lunar Landing Site Navigator_.
Checked on **2026-11-13** from a Windows dev machine. Every URL marked **verified** was requested
during this research and returned real data. Sizes are `Content-Length` headers or the sizes listed on
the provider's index page. Anything not requested is marked **unverified**.

> Network note for the team: on this machine, Git Bash's `curl` fails TLS on `ssd.jpl.nasa.gov`, `pds-geosciences.wustl.edu`
> and `naif.jpl.nasa.gov` ("self signed certificate in chain"), while Windows `curl.exe` fails on `spaceappschallenge.org`.
> Python (`urllib`) works for every host listed here. Preprocessing scripts are therefore written in Python.

## 1. What the challenge actually asks for

The challenge's Resources tab lists only three NASA tools ([Quickmap](https://quickmap.lroc.asu.edu/),
[Moon Trek](https://trek.nasa.gov/moon/), [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/)) plus CSA's
[Moon Exploration portal](https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/).
The core deliverable is **Sun and Earth position relative to the local horizon, over time**, used to judge power
and direct-to-Earth (DTE) comms. Terrain hazards (slope, roughness) are secondary but expected for landing-site work.

That means we need three kinds of data:

| Need                                                             | Best source                  | Status       |
| ---------------------------------------------------------------- | ---------------------------- | ------------ |
| Sun/Earth direction vs. time (ephemeris, libration)              | JPL Horizons API             | **verified** |
| Local terrain horizon (blocks low Sun/Earth)                     | LOLA DEMs (PGDA/PDS)         | **verified** |
| Slope, roughness, long-term illumination, Earth visibility, PSRs | LOLA derived products (PGDA) | **verified** |

## 2. Source-by-source evaluation

Difficulty scale: **Low** = usable in a browser app after a small preprocessing step. **Med** = needs GIS tooling
(GDAL/rasterio) offline. **High** = heavy download or a specialist pipeline.

### 2.1 Ephemeris: JPL Horizons API — verified, core source

- **Provides:** Sun and Earth azimuth/elevation as seen from any user-defined site on the Moon, plus sub-solar and
  sub-Earth points on the Moon (these capture libration and seasons).
- **Endpoint:** `https://ssd.jpl.nasa.gov/api/horizons.api` (GET, `format=text|json`). No key needed.
- **Verified request 1 (topocentric):** `COMMAND='10'`, `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`,
  `SITE_COORD='0,-89.5,0'`, `QUANTITIES='4'`, `APPARENT='AIRLESS'`. The result was Sun Az 280.05°, El 1.557° on 2026-12-01 00:00 UT,
  from ephemeris DE441, Moon frame `MEAN_ME`, radius 1737.4 km, no refraction.
- **Verified request 2 (sub-points):** `COMMAND='301'`, `CENTER='500@399'`, `QUANTITIES='14,15,20'`. The result was a sub-Earth
  point (libration) of 6.67°E, 1.35°N, and a sub-solar point of 280.06°E, −1.47°, on the same date.
- **Key finding:** projecting the sub-solar point onto the site normal reproduces Horizons' topocentric elevation
  (asin(0.02717) = 1.557° vs 1.557451°). So **one Horizons time series of sub-solar and sub-Earth points is
  enough to compute Sun and Earth elevation and azimuth for _any_ site in the browser.** Earth's topocentric parallax from the Moon is
  about 0.26° and must be corrected using distance (quantity 20). That is easy.
- **Horizon:** smooth sphere only. Terrain is **not** included, so we must add it from a DEM (below).
- **Format / size:** text or JSON tables. One year at a 1 h step is about 8.8k rows (a few hundred KB of JSON after trimming).
- **License:** JPL/NASA, free to use.
- **Difficulty:** **Low.**

### 2.2 Ephemeris alternative: NAIF SPICE kernels — reachable, not needed for MVP

- `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/` returned 200 via Windows curl. Kernel files were not downloaded.
- These would give full control (e.g. `moon_pa_de440` frames) but need SpiceyPy and about 100 MB+ of kernels. **Deferred.**

### 2.3 Terrain: LOLA south-pole DEMs, PGDA product 90 — verified, core source

- **Page:** <https://pgda.gsfc.nasa.gov/products/90>. _A New View of the Lunar South Pole from LOLA_, Barker et al. 2023,
  PSJ 4, 183, [doi:10.3847/PSJ/acf3e1](https://doi.org/10.3847/PSJ/acf3e1); data DOI `10.60903/gsfcpgda-lola-spole`.
- **Provides:** elevation (`LDEM`), slope (`LDSM`), height/slope error, hillshade, roughness (`LDRM`), permanent shadow (`LPSR`).
- **Format:** Cloud-Optimized GeoTIFF. South polar stereographic in metres
  (`+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400`), MOON_ME / DE421, float32, NaN nodata, overviews 2/4/8/16.
- **Verified with rasterio `/vsicurl/` windowed reads** (no full download):
  - `LDEM_80S_20MPP_ADJ.TIF`: 30400×30400 px at 20 m, extent ±304 km. A 4×4 km window at the pole read OK (heights −181…1476 m).
  - `LDSM_80S_20MPP_ADJ.TIF`: same grid; the window read OK (slopes 0.2…38.7°).
  - `LPSR_80S_20MPP_ADJ.TIF`: header OK, but **the tile read failed** (empty or sparse tile). Use the PGDA-69 LPSR instead (below).
- **Sizes (index page):** LDEM 80S 20 m = 2.6 GB, 40 m = 685 MB, 80 m = 181 MB; LDSM 80S 20 m = 3.6 GB, 80 m = 231 MB;
  LDEM 83S 10 m = 4.8 GB; LDRM 80S 1000 m roughness/slope products are about 1.5 MB each, and 50 m ones about 550–620 MB.
- **License:** NASA (public). Cite Barker et al. 2023.
- **Difficulty:** **Med.** Trivial with rasterio offline, but far too large to ship. We must window and downsample.

### 2.4 Terrain: LOLA GDR polar DEMs on PDS — verified, backup

- **Index:** `https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/{float_img,img,jp2}/`.
- Raw PDS3 `IMG` (float32, km relative to 1737.4 km), polar stereographic.
  Example `ldem_875s_20m_float.img`: 7584×7584, 20 m/px, 87.5°S–90°S, **230 MB**. The server supports HTTP `Range`.
  Other sizes: `ldem_85s_20m_float.img` 920 MB, `ldem_75s_120m_float.img` 232 MB.
- Older (2017) and noisier than PGDA 90. Useful only if PGDA is down. **Difficulty: Med.**

### 2.5 High-resolution site DEMs (5 m): PGDA 78, 81, 104 — verified pages, nice-to-have

- **81:** 5 m mosaic for 87–90°S. `ldem_87s_5mpp.tif` is **3.3 GB**, `ldsm_87s_5mpp.tif` 4.9 GB, with a hillshade at 820 MB.
  Cite Barker et al. 2021, PSS 203, 105119.
- **78:** 5 m DEMs of individual south-pole sites (sites 1, 4, 7, 11) with error ensembles.
- **104:** 5 m Shape-from-Shading DEMs of the **13 original Artemis III candidate regions** (Bertone et al.,
  [doi:10.3847/PSJ/ae5b70](https://doi.org/10.3847/PSJ/ae5b70); Zenodo 10.5281/zenodo.17954508).
- Ideal for slope and roughness at lander scale. Too heavy for the MVP. **Difficulty: High.**

### 2.6 Long-term illumination, Earth visibility and PSRs: PGDA product 69 — verified, core source

- **Page:** <https://pgda.gsfc.nasa.gov/products/69>. Mazarico et al. 2011, Icarus 211, 1066–1081.
- **Provides:** average solar visibility, average **Earth visibility** and permanent-shadow maps, computed hourly over
  18.6 years (a full nutation cycle). Earth counts as visible if _any part_ of its disc is visible, which is slightly optimistic.
- **Verified files** (GeoTIFF, `Accept-Ranges: bytes`):
  | File                                                                                  | Size    |
  | ------------------------------------------------------------------------------------- | ------- |
  | `https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_85S_060M_201608.TIF`       | 34.0 MB |
  | `https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_85S_060M_201608_EARTH.TIF` | 24.9 MB |
  | `https://pgda.gsfc.nasa.gov/data/MoonIllumination/LPSR_85S_060M_201608.TIF`           | 0.66 MB |
  | `https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_75S_120M_201608.TIF`       | 83.1 MB |
- Note: the `*_COG.TIF` link returned only 3.8 KB (likely a redirect or error page). Use the plain `.TIF`.
- 60 m/px over 85–90°S. These are long-term **averages**, not date-specific. **Difficulty: Low/Med.**

### 2.7 Roughness: PGDA product 98 / `LDRM` files — verified listing

- _Large-Scale Roughness Properties of the Lunar Poles_. The south-pole LDRM COGs are listed on product 90's page.
- `LDRM_80S_1000MPP_ADJ_ROUGH_100M.TIF` etc. are about 1.5 MB at 1 km/px (coarse). The 50 m versions are about 600 MB.
- For the MVP it's cheaper to derive a roughness proxy from the 20 m DEM window (local slope variability). **Difficulty: Low.**

### 2.8 Imagery and basemap tiles: NASA Moon Trek WMTS — verified

- Capabilities: `https://trek.nasa.gov/tiles/Moon/SP/LRO_WAC_Mosaic_SPole60_100mp/1.0.0/WMTSCapabilities.xml`.
- Tile template: `https://trek.nasa.gov/tiles/Moon/SP/LRO_WAC_Mosaic_SPole60_100mp/1.0.0/default/default028mm/{z}/{row}/{col}.png`.
  Tile `3/3/3` returned 200 `image/png`, 67.5 KB, **`Access-Control-Allow-Origin: *`** (browser-friendly).
- Projection: south polar stereographic, extent ±931,100 m, 256 px tiles, top-left (−1,095,930, 1,095,930), CRS id `EPSG::0`
  (custom). Needs a client that supports custom projections (OpenLayers or Proj4Leaflet). **MapLibre/Web Mercator won't work.**
- Moon Trek also exposes elevation-profile and search services (`/moon/TrekServices/ws/...`). The `searchItems` call
  returned an empty body (**unverified**). An ArcGIS ImageServer for the 100 m south-pole DEM is listed in its config (**unverified**).
- **Difficulty: Low** for tiles. Medium for the services, because they're undocumented.

### 2.9 Imagery: LROC NAC/WAC, QuickMap — reachable, mostly deferred

- `https://quickmap.lroc.asu.edu/` returned 200 (a JS app). The RDR product selector `https://wms.lroc.asu.edu/lroc/rdr_product_select` returned 200.
- NAC images are 0.5–2 m/px with huge files, and at the pole they're mostly shadowed. WAC polar mosaics are better consumed via Moon Trek tiles.
- LROC's IM-2 landing-region page (<https://www.lroc.asu.edu/images/1401>) returned 200. Search results quote the intended site as
  84.78°S, 29.13°E (**the coordinate itself was not read from the page yet; verify before use**).
- Credit line: "NASA/GSFC/Arizona State University". **Difficulty: High** for raw NAC, Low via Trek tiles.

### 2.10 Thermal: LRO Diviner — partially verified, deferred

- PDS: `https://pds-geosciences.wustl.edu/lro/lro-l-dlre-4-rdr-v1/` (200). It contains per-year RDR directories plus a 30 MB inventory CSV.
  These are **swath-level** data and not convenient to use.
- Gridded polar temperature summaries (e.g. max/min or average maps) exist in the literature, but **no file URL was verified**. **Unverified.**
- Thermal isn't required by the challenge. **Deferred.**

### 2.11 Hazards: boulders and craters — unverified, deferred

- No ready, browser-sized south-pole boulder or crater catalog was verified. Hazard is approximated by **slope**
  (PGDA LDSM) and **roughness** (DEM-derived). The 5 m SfS DEMs (2.5) are the post-hackathon upgrade path.

### 2.12 Context: names, Artemis regions, missions

- **IAU Gazetteer** (verified): `https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.kmz`
  (11.7 MB KMZ, with center lat/lon and diameter per feature). Examples read from it:
  Shackleton −89.67°, 129.78°E (Ø 20.9 km); de Gerlache −88.485°, 271.655°E; Spudis −89.51°, 275.39°E;
  Henson −88.57°, 229.37°E; Sverdrup −88.32°, 206.61°E; Haworth −87.45°, 354.83°E; Faustini −87.18°, 84.31°E;
  Shoemaker −88.14°, 45.91°E; Slater −88.08°, 111.29°E.
- **USGS STAC** (`https://stac.astrogeology.usgs.gov/api/collections`, verified) has 18 collections, including
  `lunar_orbiter_laser_altimeter` and Kaguya south-polar DTMs. Items weren't explored. **Nice-to-have.**
- **Artemis III regions (Oct 2024):** news coverage lists nine names: Peak near Cabeus B, Haworth, Malapert Massif,
  Mons Mouton Plateau, Mons Mouton, Nobile Rim 1 and 2, de Gerlache Rim 2, Slater Plain. NASA published **regions as map outlines**,
  not point coordinates, and no machine-readable file was found. **Unverified as data.** We use names only, with
  approximate anchor points from the Gazetteer clearly labelled as approximate.

## 3. Recommendation

### Minimum set for the MVP

1. **JPL Horizons API.** Precompute a 1 h time series of sub-solar and sub-Earth lon/lat plus Earth distance for a
   ~1-year window (e.g. 2026-12 → 2027-12). The browser computes Sun and Earth elevation/azimuth for any site.
2. **PGDA 90 LDEM (20 m COG, windowed) and LDSM.** These give per-site slope, a roughness proxy and a **terrain horizon mask**
   (360 azimuth bins) for each candidate site. The far-field horizon (out to ~150 km) uses the same COG's overviews.
3. **PGDA 69 AVGVISIB (Sun), AVGVISIB_EARTH and LPSR at 60 m.** These provide map layers (long-term illumination, Earth
   visibility, permanent shadow), plus a long-term sanity check on our date-specific numbers.
4. **IAU Gazetteer** for feature labels and named anchor points.

All of these are fetched once by Python scripts in `scripts/`. The output is small committed PNGs and JSON (target < 5 MB total).
No NASA calls happen at runtime.

### Nice-to-haves (post-MVP)

Moon Trek WAC tiles as a live basemap, 5 m SfS DEMs for Artemis regions (PGDA 104), LDRM roughness, Diviner
temperatures, a second region (e.g. Malapert/Mons Mouton or Nobile), a live Horizons proxy route for arbitrary dates,
and SPICE for offline high-precision work.

### Demo region and resolution

- **Region:** the Shackleton – de Gerlache corridor around the pole. Polar-stereographic box x, y ∈ [−50, +50] km
  (100 × 100 km), covering Shackleton, Spudis, Marvin, de Gerlache (Artemis "de Gerlache Rim 2"), Henson and Haynes.
  It's the most studied and most contrasting terrain: near-permanent light on rims next to permanent shadow.
- **Analysis resolution:** 20 m/px source (PGDA 90) for per-site slope and horizons. Horizon rays reach ~150 km,
  using lower-resolution overviews beyond ~10 km.
- **Display resolution:** 100 m/px raster layers (1000 × 1000 PNG, about 0.3–1 MB each): hillshade, slope, long-term
  illumination, Earth visibility, PSR.
- **Candidate sites:** ~15–25 auto-selected spots (well lit, slope < 10°, spaced ≥ 3 km), named by their nearest Gazetteer
  feature, plus user-entered custom coordinates. Custom points outside the region get **ephemeris-only** analysis
  (smooth-sphere horizon), clearly labelled.

### What happened during the build (2026-11-13)

- **PGDA rate limiting:** after a few hundred range reads, `pgda.gsfc.nasa.gov` began answering with empty bodies and then
  **HTTP 503**. The build script now reads in chunks with retries and caches every grid in `scripts/.cache/`.
- **PGDA-69 products from the PDS mirror:** the same files are served (verified 200, 51.2 MB each) as PDS3 IMG plus label at
  `https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/` (`AVGVISIB_85S_060M_201608`, `..._EARTH`, `LPSR_85S_060M_201608`; int16,
  scale 0.00004 to a 0–1 fraction). We use this mirror because it's the LOLA PDS data node.
- **Per-site slope:** PGDA's 20 m LDSM was unreachable at site-metric time, so slope was computed from the 40 m LDEM overview (recorded
  as `slopeSource`). The slope _map layer_ is PGDA's real LDSM, averaged to 100 m.
- **Georeferencing check:** the three crater-floor reference sites (IAU centres of Shackleton, de Gerlache and Spudis) fall inside the LPSR
  mask with 0 % Sun and 0 % Earth, so the DEM and illumination grids agree.

### Known accuracy caveats (to show in the UI and README)

- The DEM frame (MOON_ME realised with DE421) and Horizons' body frame (`MEAN_ME`, DE441) are both mean-Earth/polar-axis
  frames. Any offset between the realisations is small, but **we have not quantified it**. It's documented as a known limitation.
- Earth "visible" means disc center above the horizon in our computation. PGDA uses any part of the disc, so expect small differences.
- No sub-pixel terrain (boulders under ~20 m). Horizons are computed for a fixed 2 m observer height.
