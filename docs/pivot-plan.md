# Pivot plan: from site ranker to Landing Site Navigation Panel

Status: **draft, awaiting team confirmation** (2026-11-14).

## What exists (audit of `feature/create-poc-nextjs`)

- **Next.js 16 + TS, fully static**, OpenLayers map in polar stereographic, Vitest, ESLint rules that keep `domain/` free of React/Next/OL.
- **Real data, precomputed** (`public/data/`, ~1.6 MB): JPL Horizons sub-Sun/sub-Earth series (Nov 2026 – Jan 2028, 1 h),
  18 candidate + 3 reference **sites** with LOLA-derived slope, roughness, PSR distance and a 720-bin terrain horizon mask,
  and PNG layers (hillshade, PGDA slope, 18.6-yr Sun/Earth visibility, PSR).
- **Domain**: `geo/polarStereo`, `ephemeris/localSky` (validated vs Horizons within 0.05°), `visibility/windows`
  (sunlit %, longest night, next set), `scoring/` (ramps, presets, no-go flags, explanation sentences).
- **Provider**: `LunarDataProvider { getRegion, getSites, getEphemeris }`, static implementation only.
- **UI**: 3-column layout (scenario+weights | map | site list+detail), horizon panorama, clearance timeline, custom sites.

## Conflicts with the brief, and what I recommend

| # | Conflict | Recommendation |
| - | -------- | -------------- |
| 1 | The brief scores **grid cells** (gates, heatmaps, NMS top-3). The app scores **21 sites**, and the browser has no DEM, only PNGs. | Add an offline **analysis grid**: 500 m cells over the 100 × 100 km region (200 × 200 = 40k cells) with elevation, slope (mean/max from 20–40 m data), roughness, PSR distance and a **90-bin (4°) horizon mask** (uint8, 0.1° steps, max-pooled so it stays conservative). That is about 3.8 MB raw and ~1.5 MB gzipped binary. Shadows then become a per-cell lookup of Sun elevation against the horizon, which is fast enough in a Web Worker. Ray marching stays **offline**, where it already runs. Sites stay as a curated layer on top. |
| 2 | The `scripts/.cache` DEM cache is **not on this machine**, and PGDA rate-limited us (HTTP 503) last build. | Re-run the build with chunked, cached reads. If PGDA stays down, use a **SIMULATED** fallback grid derived from the committed 100 m PNG layers, labelled as such. Raw ~200 MB download, nothing heavy committed. |
| 3 | Provenance: the code uses `real \| derived \| mock`, the brief wants `MEASURED \| DERIVED \| SIMULATED` plus confidence. | Replace with `{ kind: "measured" \| "derived" \| "simulated", confidence: "high" \| "medium" \| "low", source }`. Map real→measured and mock→simulated, and migrate all usages. |
| 4 | Slope gate of **5°** (brief) vs **15°** today. At 500 m, mean slope is smoothed. | Gate on **max slope within the cell** from 40 m data. 5° is the default but configurable, and the UI shows how many cells it excludes. Logged in `decisions.md`. |
| 5 | The "no comms window" gate needs the relay module, which the build order puts after scoring. | Scoring ships with connectivity = **DTE** (real Earth visibility). The relay gate and factor are wired in when module 3 lands. Final connectivity = best of DTE and relay. |
| 6 | Ephemeris: the brief allows a library or analytic model. | Keep **Horizons precomputed** (real, validated). Mission Setup clamps dates to the shipped coverage and gives a friendly error outside it. |
| 7 | Sensor analogs (Mini-RF CPR, Diviner, LEND, M3, Clementine FeO/TiO₂) are **all unverified** in `data-sources.md`. | Verify each with real requests at the start of the sensor module. Anything unreachable becomes a SIMULATED layer behind the same `getLayer` interface, marked "unverified". |

## Module boundaries (adjusted to the real code)

```
src/domain/                    pure TS, no React/Next/OL (ESLint-enforced)
  provenance.ts                Provenance, Confidence, Tagged<T>
  grid/                        Grid<T> (typed array + extent), sampling, NMS          ← NEW
  mission/                     MissionSetup type, validate(), ISO ⇄ Julian day          ← NEW
  ephemeris/                   localSky (KEEP), sunDirection(t), earthDirection(t)
  illumination/                cellIllumination(grid, eph, window) → fraction grid + series  ← NEW (reuses visibility/)
  visibility/                  KEEP: horizon lookup, windows
  comms/                       relayOrbit (NRHO approx), lineOfSight, contactWindows, latency, band params  ← NEW
  sensors/                     SensorLayer interface + lidar/sar/radiometer/spectrometer  ← NEW
  scoring/                     REFACTOR: gates.ts, normalize.ts (piecewise), score.ts, presets.ts, top3.ts, explain.ts
  inspector/                   prosCons(cell, ctx) → tagged items, sensitivity(time, weights)  ← NEW
src/data/                      provider gains getAnalysisGrid(); sensors/ adapters (static | synthetic)
src/workers/                   grid compute (illumination, scoring) off the main thread  ← NEW
src/features/                  setup/, map/ (heatmap + layer switcher), insights/, timeline/ (scrubber + comms),
                               inspector/, compare/, tour/. Reuse: map/LunarMap, sky/HorizonView, sky/Timeline, weights/
scripts/build_grid.py          NEW: writes public/data/grid/*.bin + grid.json
```

## Reuse / refactor / new

- **Reuse as-is:** `polarStereo`, `angles`, `localSky` + fixtures, `horizon.ts`, `windows.ts`, OL map setup, `HorizonView`, `Timeline`, Python fetch/cache utilities.
- **Refactor:** `types.ts` (provenance), `scoring/` (two-stage gates + weights summing to 1, new factor set safety/science/connectivity/power,
  piecewise normalization, presets Safety/Science/Comms-first), `provider.ts` (+grid, +sensors), `NavigatorApp` layout.
- **New:** analysis grid, mission setup, illumination grid + worker, relay comms, sensor layers, top-3 NMS, inspector, compare, tour, demo scenario, docs.

## Build order and checkpoints

1. Provenance refactor + Mission Setup + grid pipeline + illumination (worker, heatmap, light/shadow scrubber)
2. Sensor layers (verify datasets first)
3. Scoring docs (`docs/scoring-model.md`) → **pause for review** → gates, soft score, top-3, explanations
4. Relay comms + comms timeline
5. Point inspector + compare
6. Polish: modes, tour, Shackleton demo, accessibility, README

Each module runs `lint`, `typecheck`, `test` and `build`, and gets small conventional commits.
**Dependencies:** none planned. Workers, charts, tour and heatmap rendering use native APIs, SVG and OL `ImageCanvas`.
