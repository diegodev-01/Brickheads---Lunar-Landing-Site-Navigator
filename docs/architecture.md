# Architecture: Lunar Landing Site Navigator (MVP)

Goal: a static-first web app that ranks south-pole landing sites by an explainable score and shows **when** the Sun
and Earth are above the _real_ horizon at each one. Data choices are in [research/data-sources.md](research/data-sources.md).

## 1. Shape of the system

```
 offline (Python, scripts/)                         runtime (Next.js, browser)
 ───────────────────────────                        ─────────────────────────────────────────────
 Horizons API ──► ephemeris.json  (sub-Sun/sub-Earth, 1 h step, Nov 2026 – Jan 2028)
 PGDA LDEM/LDSM ─► sites.json     (per-site slope, roughness, PSR distance,      ──► data provider ──► domain (pure TS)
                                   360-bin terrain horizon mask)                       (fetch JSON)      geometry, visibility,
 PGDA 69 maps ───► layers/*.png   (hillshade, slope, illumination, Earth vis, PSR)                       scoring
 IAU Gazetteer ──► features.json  (labels)                                       ──► features (React UI) ◄──┘
```

Heavy work (GeoTIFF reads, ray-cast horizons) happens **once, offline**. The browser does cheap work: for N sites × ~720
hourly samples (a 30-day window), it computes Sun and Earth elevation against each site's horizon mask, then scores.
That's about 10⁴ trig evaluations, under 5 ms, so changing a weight or date re-ranks instantly with no server round trip.

## 2. Folder structure and boundaries

```
src/
  app/                  routing only: layout.tsx, page.tsx (server shell), globals.css
  domain/               pure TypeScript, NO React/Next/DOM imports, fully unit-tested
    geo/                polarStereo.ts (lon/lat ⇄ x/y), angles.ts
    ephemeris/          localSky.ts: sub-point + distance → az/el at a site (incl. Earth parallax)
    visibility/         horizon.ts (mask lookup, interpolation), windows.ts (sunlit %, Earth %, next set/rise)
    scoring/            config.ts (ramps, limits, weight presets), factors.ts, score.ts, explain.ts
    types.ts            Site, HorizonMask, EphemerisSample, FactorResult, ScoreBreakdown…
  data/                 adapters behind an interface
    provider.ts         interface LunarDataProvider
    static/             StaticDatasetProvider: reads /public/data/*.json
    index.ts            getDataProvider(): picks the implementation from env (default: static)
  features/             UI by feature; may import domain + data, never each other's internals
    map/                OpenLayers map, layer toggle, site markers
    sites/              ranked list, site detail panel (score, breakdown, explanation)
    weights/            weight sliders + presets
    sky/                horizon panorama (SVG) + Sun/Earth clearance timeline (SVG)
    scenario/           date-window picker, useNavigator() state hook
  components/ui/        tiny shared primitives (Panel, Slider, Badge)
scripts/                Python preprocessing (requirements.txt, README) → writes public/data/
public/data/            committed, lightweight outputs (< 5 MB total)
```

Dependency rule: `app → features → (data, domain)` and `data → domain`. `domain` imports nothing outside itself.
This is enforced with an ESLint `no-restricted-imports` rule on `src/domain/**`.

## 3. Swappable data provider

```ts
export interface LunarDataProvider {
  getRegion(): Promise<RegionMeta>; // extent, projection, available raster layers, attribution
  getSites(): Promise<SiteRecord[]>; // static terrain metrics + horizon mask per site
  getEphemeris(range: TimeRange): Promise<EphemerisSeries>; // sub-solar / sub-Earth samples
}
```

The MVP ships `StaticDatasetProvider`. Later you can add a `HorizonsProvider` (calls our own `/api/ephemeris` Route Handler,
which proxies and caches Horizons for arbitrary dates) or a `TrekProvider` (live tiles) with **no UI change**: features
only see the interface. Every payload carries `provenance: "real" | "derived" | "mock"`, which the UI shows as a badge.

## 4. Scoring engine (pure, explainable)

Each factor is a small object: `{ id, label, unit, raw(site, ctx), normalize(raw) → 0..1, explain(raw, n) → string }`.

| Factor                 | Raw value (source)                                              | Normalization (configurable thresholds) |
| ---------------------- | --------------------------------------------------------------- | --------------------------------------- |
| Sunlight               | % of window Sun center above terrain horizon (ephemeris + mask) | linear 0 → 100 %                        |
| Earth visibility (DTE) | % of window Earth center above terrain horizon                  | linear 0 → 100 %                        |
| Slope                  | mean slope in a 100 m radius (LDSM)                             | 1 at ≤ 2°, 0 at ≥ 15°                   |
| Roughness              | local slope variability in a 200 m radius (from LDEM)           | 1 at ≤ 1°, 0 at ≥ 8°                    |
| Ice access             | distance to nearest permanently shadowed pixel (LPSR)           | 1 at ≤ 1 km, 0 at ≥ 20 km               |

`score = Σ wᵢ·nᵢ / Σ wᵢ`, scaled to 0–100. Weights live in `config.ts` (defaults plus presets such as _Power-first_,
_Comms-first_, _Science-first_). **Hard constraints** (for example slope > 15°) don't change the score. They add a
`no-go` flag with a reason, so ranking and safety stay separate and visible.
`explain.ts` returns contributions sorted by impact, plus sentences like _"Ranks #2: sunlit 87 % of the window
(strong), but Earth is below the horizon 61 % of the time (weak DTE)."_ Thresholds come from config. They're
**illustrative defaults, not mission requirements**, and the UI says so.

Tests (Vitest) cover:

- normalization edges
- weight changes reordering the ranking
- hard constraints
- zero weights
- `localSky` against real Horizons topocentric values captured as fixtures
- horizon interpolation across 359°→0°
- window/next-sunset logic

## 5. Map: OpenLayers (not MapLibre or Leaflet)

All data lives in **south polar stereographic metres** (PGDA rasters, Moon Trek SP tiles). MapLibre only supports Web Mercator,
which can't represent the pole. Leaflet needs Proj4Leaflet plus plugins. OpenLayers natively supports a custom
`Projection({ code: 'MOON:SP', units: 'm', extent })`, static image layers in that projection, and WMTS (for Moon Trek
tiles later). The lon/lat ⇄ x/y math lives in `domain/geo/polarStereo.ts` (spherical, R = 1737.4 km, same as the PGDA
products), so we don't need `proj4`. **Dependency added: `ol`** (ES modules, so only the parts we import get bundled; only the modules we import are bundled).
The map component loads client-only via `next/dynamic({ ssr: false })`.

## 6. Server vs client

- **Server:** `page.tsx` is a static server component (layout, attribution, initial markup). Build output is fully static.
  No Route Handlers in the MVP. The first one, deferred, is `/api/ephemeris` (Horizons proxy with caching).
- **Client:** data fetch from `/data`, all domain computation, map and charts.
- **Offline:** `scripts/*.py` (rasterio + numpy) for windowed COG reads, horizon ray-casting, and PNG/JSON export.
  These are run by a developer, not needed for `npm run dev`, because outputs are committed.

## 7. State

React `useReducer` inside one `useNavigator()` hook in `features/scenario`, passed down via a small context:
`{ weights, presetId, windowStartMs, windowDays, selectedId, layerId, customSites }`. Derived values (per-site visibility,
scores, ranking) come from `useMemo` over domain functions. **No state library.** If URL sharing of scenarios is wanted,
add `useSearchParams` sync later.

## 8. Charts

Two hand-written SVG components, so no chart library is needed:

- a **horizon panorama**: azimuth across, elevation up, with the terrain horizon as a filled silhouette and Sun/Earth tracks for
  the window. We chose this over a polar sky plot because at the pole everything happens within a few degrees of the horizon,
  and a polar plot squeezes that into its rim.
- a **timeline**: Sun and Earth elevation minus horizon over the window, with shaded "sunlit" and "Earth visible" bands
  and "sunset in X h" markers

These make the "small changes, large impact" point visible.

## 9. Trade-offs

- **Precomputed vs live:** fast, offline-capable and demo-safe, but limited to the shipped region and ephemeris window (Nov 2026 – Jan 2028).
- **Center-of-disc visibility:** simpler than partial-disc models. Sun is about 0.27° in radius and Earth about 0.95°, so sunrise/set times can shift by hours
  at grazing angles. Documented, and fixable in `horizon.ts`.
- **20 m DEM:** misses boulders and sub-pixel hazards. Slope and roughness are proxies, and the 5 m SfS DEMs are the upgrade path.
- **One region:** keeps assets under 5 MB. The provider interface allows adding regions as more `RegionMeta` entries.

## 10. Intentionally deferred

Live Horizons proxy, Moon Trek basemap, 3D terrain, multiple regions, configurable lander height (fixed at 2 m), side-by-side compare view, partial-disc and thermal
models, Diviner, PWA/offline, i18n, URL-shareable scenarios, auth, database, and backend services.

## 11. As built (MVP notes)

- **Candidate sites** are auto-selected by `scripts/build_region.py`: well lit long-term (PGDA), smoothed slope ≤ 8°, not
  in a PSR, ≥ 4 km apart (18 sites). Three **reference** crater-floor sites (Shackleton, de Gerlache, Spudis) show the
  contrast. Names come from the nearest IAU feature ("Shackleton rim", "near Henson"…). They are not official mission sites.
- **Horizon masks:** 720 bins (0.5°), observer 2 m above the surface. Rays use the 40 m DEM to 15 km and the 320 m DEM to 180 km,
  both read as COG overviews of PGDA `LDEM_80S_20MPP_ADJ`, with curvature drop d²/2R.
- **Per-site terrain:** mean and max slope within 100 m, and slope std-dev within 200 m (roughness proxy). These come from PGDA's
  20 m LDSM when reachable, otherwise slope computed from the 40 m LOLA DEM for _all_ sites, so the ranking stays consistent.
  The committed build used the 40 m fallback (`slopeSource` in `sites.json`). PSR distance comes from the 100 m-resampled LPSR.
- **Validation:** `scripts/validate_horizons.py` compares our horizon-based Sun/Earth % (14 months) with PGDA's 18.6-year maps:
  r = 0.98 / 0.99, mean abs diff 10 / 3 points. `localSky` matches Horizons topocentric output within 0.05° (unit tests).
- **Custom sites:** click empty ground or enter lat/lon. They get a smooth-sphere horizon, and terrain factors are reported as
  "not scored" (weights renormalise), so they stay comparable but are clearly labelled.
- **Tooling:** Vitest 4.0.18 (Vitest 5 needs Node 22). ESLint `no-restricted-imports` enforces the layer rules in section 2.
