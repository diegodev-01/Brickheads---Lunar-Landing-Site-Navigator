# Brickheads · Lunar Landing Site Navigator

Our entry for the [NASA Space Apps Challenge 2026](https://www.spaceappschallenge.org/2026) challenge
[**Lunar Landing Site Navigator**](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/).

At the Moon's south pole the Sun and Earth skim the horizon. A ridge a few kilometres away can mean weeks of
darkness or no radio link, and a one-week launch slip can change everything. This app lets mission planners,
educators and the public **compare landing sites and dates in seconds**:

- **Map** of a 100 × 100 km region around the south pole (Shackleton – de Gerlache), with layers for terrain, slope,
  long-term sunlight, Earth visibility and permanent shadow.
- **Candidate sites ranked live** by an explainable suitability score: sunlight, Earth-in-view (direct-to-Earth comms),
  slope, roughness, and distance to permanently shadowed regions (ice).
- **Adjustable weights** and mission presets (Power / Comms / Science-first). Ranking updates instantly.
- **Landing date and window**, plus "slip launch ±N days" buttons to see how schedule changes affect each site.
- **Per-site detail**:
  - score breakdown and a plain-language "why"
  - Sun and Earth position at landing, time to sunset/Earthset, longest night or comms blackout
  - a **horizon panorama** showing Sun/Earth tracks against the real LOLA terrain silhouette
  - a timeline of clearance above terrain
- **Custom coordinates** anywhere on the Moon (smooth-sphere horizon, clearly labelled).

## Run it

Requires Node.js ≥ 20.9.

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts:

| Script                        | What it does                           |
| ----------------------------- | -------------------------------------- |
| `npm run build` / `npm start` | production build / serve               |
| `npm run lint`                | ESLint (includes layer-boundary rules) |
| `npm run typecheck`           | `next typegen` + `tsc --noEmit`        |
| `npm test`                    | Vitest unit tests (domain layer)       |
| `npm run check`               | lint + typecheck + test + build        |
| `npm run format`              | Prettier                               |

The app is fully static: all data is precomputed and committed under `public/data/` (~1.6 MB). No API keys and no NASA calls
at runtime.

## How it works

```
scripts/ (Python, offline)                     src/ (Next.js, browser)
JPL Horizons ─► ephemeris.json  ─┐
PGDA LOLA DEM/slope ─► sites.json│ ─► data/ (provider) ─► domain/ (pure TS: geometry, visibility, scoring)
PGDA illumination ─► layers/*.png┘                       ─► features/ (map, list, detail, charts)
```

1. **Ephemeris.** Horizons gives hourly sub-solar and sub-Earth points on the Moon (DE441, includes libration). The browser
   converts them into Sun and Earth azimuth/elevation for any site. This is validated against Horizons' own topocentric output within
   0.05° (`src/domain/ephemeris/localSky.test.ts`).
2. **Terrain horizon.** For each site, `scripts/build_region.py` ray-casts the LOLA DEM out to 180 km. It uses 40 m data out to 15 km and
   320 m beyond, with lunar curvature applied, giving a 720-bin horizon mask. **Cross-check:** sunlit/Earth-visible % from our
   masks plus the ephemeris correlate with PGDA's independent 18.6-year maps at r = 0.98 (Sun) and r = 0.99 (Earth), with mean
   differences of 10 and 3 points. See `python scripts/validate_horizons.py`. Our Sun % runs higher (2 m observer height,
   centre-of-disc test, smoother DEM).
3. **Visibility.** The Sun or Earth counts as "in view" when its centre is above the terrain horizon at its azimuth.
4. **Score.** `score = 100·Σ wᵢ·nᵢ / Σ wᵢ`, where each factor is normalised 0–1 with configurable thresholds
   (`src/domain/scoring/config.ts`). Hard limits (slope > 15°, site inside permanent shadow) raise **no-go** flags
   instead of silently changing the score.

Architecture and trade-offs: [docs/architecture.md](docs/architecture.md). Data survey: [docs/research/data-sources.md](docs/research/data-sources.md).

## Real vs derived vs mock data

| Data                                              | Status                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Sun/Earth ephemeris (`ephemeris.json`)            | **Real**: JPL Horizons, Nov 2026 – Jan 2028, 1 h step                                        |
| Slope, sunlight, Earth visibility, PSR map layers | **Real**: NASA GSFC PGDA products, resampled to 100 m                                        |
| Hillshade layer                                   | **Derived** from the real LOLA DEM                                                           |
| Site slope / roughness / horizon / PSR distance   | **Derived** from real LOLA data by our scripts (per-site slope from the 40 m DEM, see below) |
| Candidate site _locations_                        | **Derived**: auto-selected well-lit, gentle spots (not official mission sites)               |
| Scoring thresholds and weights                    | **Illustrative** defaults, not mission requirements                                          |
| Mock data                                         | None in the app (tests use synthetic inputs)                                                 |

## Known limitations

- **Sun/Earth "in view" = disc centre above terrain.** At grazing angles, rise and set times can differ by hours from a partial-disc model.
- **Per-site slope and roughness** come from the 40 m LOLA DEM. PGDA's 20 m slope map was rate-limited (HTTP 503) during our build, and the
  script uses it automatically when reachable. The **slope map layer** is PGDA's real 20 m slope map, averaged to 100 m.
- **Horizon masks** use a 40 m / 320 m DEM and a fixed 2 m observer height, so small peaks are smoothed out.
- **One region and one ephemeris window** (Nov 2026 – Jan 2028). Custom sites outside the region get no terrain horizon.
- Candidate sites are algorithmic picks, not NASA's Artemis III regions or CLPS targets.
- The DEM frame (DE421) vs ephemeris (DE441) offset is not quantified.

## Regenerating the data (optional)

```bash
python -m venv scripts/.venv
scripts/.venv/Scripts/pip install -r scripts/requirements.txt     # macOS/Linux: scripts/.venv/bin/pip
python scripts/fetch_ephemeris.py                                   # stdlib only
scripts/.venv/Scripts/python scripts/build_region.py                # PGDA COG windows + LOLA PDS files, ~200 MB download
```

Intermediate files are cached in `scripts/.cache/` (git-ignored).

## Extending it

- **New data source:** implement `LunarDataProvider` (`src/data/provider.ts`) and register it in `src/data/index.ts`.
  The UI only talks to that interface.
- **New scoring factor:** add it to `FACTOR_IDS`, `DEFAULT_CONFIG.ramps` and `FACTORS`. Unit-test it in `scoring.test.ts`.
- **New region:** change `REGION` in `scripts/build_region.py` and re-run it.
- **Arbitrary dates:** re-run `fetch_ephemeris.py --start … --stop …`, or add a Route Handler that proxies Horizons.

## Data sources and attribution

- **LOLA south-pole topography and slope:** NASA GSFC Planetary Geodesy Data Archive (PGDA), Barker, M.K. et al. (2023),
  _A New View of the Lunar South Pole from the Lunar Orbiter Laser Altimeter (LOLA)_, PSJ 4:183,
  [doi:10.3847/PSJ/acf3e1](https://doi.org/10.3847/PSJ/acf3e1). <https://pgda.gsfc.nasa.gov/products/90>
- **Illumination, Earth visibility and permanent shadow maps:** NASA GSFC PGDA, Mazarico, E. et al. (2011), _Illumination
  conditions of the lunar polar regions using LOLA topography_, Icarus 211:1066–1081,
  [doi:10.1016/j.icarus.2010.10.030](https://doi.org/10.1016/j.icarus.2010.10.030). <https://pgda.gsfc.nasa.gov/products/69>
- **Ephemeris:** NASA/JPL Horizons System, <https://ssd.jpl.nasa.gov/horizons/>
- **Feature names:** IAU/USGS Gazetteer of Planetary Nomenclature, <https://planetarynames.wr.usgs.gov/>
- Mission context: NASA Artemis III candidate regions (Oct 2024 announcement). Names only, no official coordinates used.

NASA data is used under NASA's media and data usage guidelines. This project is not endorsed by NASA.
