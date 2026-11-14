# Decision log

Minor decisions taken while building the navigation panel (major ones are in [pivot-plan.md](pivot-plan.md)).
Newest last. Format: decision, why, how to revisit.

## Step 1: setup + illumination (2026-11-14)

1. **Provenance labels are `measured | derived | simulated` + confidence + `verified`.** Legacy `real` / `mock`
   in data files are mapped at the provider boundary (`parseProvenanceKind`); unknown labels become
   `simulated` so nothing is ever upgraded by accident. A computed value is never "measured"
   (`combineProvenance`).
2. **Mission time is UTC only.** An ISO string without a zone is read as UTC, never the browser's local time.
   Julian Day uses the Unix-epoch offset and ignores leap seconds (< 1 min, far below the 1 h ephemeris step).
3. **Times outside the bundled ephemeris (Nov 2026 – Jan 2028) are rejected**, with a message giving the
   valid range. We do not extrapolate Horizons data.
4. **The region of interest is a square around the target** (10–100 km wide), clipped to the mapped region. It's
   simpler for non-experts than drawing a polygon.
5. **Analysis grid at 500 m (200 × 200 cells).** 40 m slope data is upsampled ×2 to 20 m so 25 × 25 sub-pixels
   tile each cell exactly. Per cell we store the mean slope and the **95th-percentile slope**. P95 is used for
   the safety gate later: max slope is dominated by single noisy pixels, and mean hides steep patches.
6. **Horizon masks: 90 bins of 4°, max-pooled from 2° rays, quantised UP to 0.1°.** Lookup uses the nearest bin.
   Every approximation errs toward _more_ shadow, never less. Rays step 40 m out to 4 km, then grow 1.5 %/step
   (40 m DEM) and 2 %/step (320 m DEM) out to 180 km. Accuracy is checked against PGDA's independent
   long-term maps (`grid.json → validation`).
7. **Partial solar disc, linear approximation.** Visible fraction = clamp((el − horizon)/(2r) + 0.5). The site-based
   panels still use the centre-of-disc test, and both are documented.
8. **Slope source: PGDA LDSM (measured) averaged to 40 m.** If PGDA is unreachable, the build falls back to slope
   from the 40 m DEM and labels it `derived` / medium confidence in the manifest.
9. **Horizon ray-casting runs in a single process.** On Windows, a process pool spent longer pickling the DEMs to
   spawned workers than the ~2 min of work, and it stalled once in testing.
10. **The analysis worker loads the grid itself** through the same data provider, so the 3.6 MB of horizons is
    never copied between threads. Results come back as transferable `Float32Array`s.
11. **Window sampling step:** 1 h for windows up to 14 days, 2 h up to 30 days, 4 h beyond. This keeps a
    recompute of ~350 samples × 40k cells × 2 bodies to well under a second.
12. **Heatmap palettes are sequential and lightness-monotonic** (inferno-like for Sun, blue-white for Earth),
    so they read in greyscale and for colour-vision deficiencies. Each legend states in words what low and high
    mean. The green/yellow/red suitability palette, with icons and patterns, comes with scoring.
13. **Sun-direction indicator uses map bearing (= sub-solar longitude).** "Azimuth from local north" has no
    meaning at the pole itself, but the map is fixed with 0°E up.
14. **Mission Setup form remounts (React `key`) when the scenario changes elsewhere**, instead of syncing state
    in an effect.

## Step 2: sensor layers (2026-11-14)

15. **One contract for every instrument:** `getLayer(roi?, timeMs?, ctx?) → {grid, units, provenance, confidence}`
    (`domain/sensors`). The source fields come from the data provider, which falls back to synthetic fields
    tagged SIMULATED / low / unverified if `public/data/sensors` cannot be loaded, so the demo always works offline.
16. **Real where verified, labelled models elsewhere.** Real: Diviner temperatures and ice stability, Mini-RF
    CPR, LP GRS FeO/TiO₂, LOLA slope/roughness. Modelled (SIMULATED): boulder hazard, hydrogen ppm,
    temperature at the scrubber time, ice probability index. The formulas are in `sensors.ts` and in
    `scoring-model.md`.
17. **Temperature "now"** = Tavg + (Tmax − Tavg) × sunlit fraction. This ignores thermal inertia and is shown
    only for day/night contrast.
18. **Ice probability** = 0.55 surface-stable fraction + 0.15 shallow-ice ramp (0.5 m → 0) + 0.20 PSR + 0.10
    CPR ramp, renormalised over available inputs. Levels: High ≥ 0.5, Medium ≥ 0.25. Surface stability
    dominates, so a sunlit rim with buried ice ~10 cm down reads "Low" for _surface_ ice.
19. **Diviner `-1` ice depth read as "surface-stable"** (undocumented code, only in Tmax < 110 K areas).
20. **Mini-RF CPR per cell = median of pixels ≤ 3** (noise in shadow made the mean unusable, e.g. 6.9 at a
    sunlit rim).
21. **Sensor colour scales** are lightness-monotonic: hazard (pale → dark brown), thermal (magma), ice (mako),
    radar (greys), composition (viridis). Each legend states what low and high mean.

## Step 3: scoring and top 3 (2026-11-14)

22. **Lander-scale slope gate approved:** a cell needs a circle of radius ≥ 100 m with every 40 m slope ≤ θ (θ ∈
    {5, 8, 10, 15}°, default 5°). `build_grid.py` stores `safeRadius{θ}` from a distance transform. 29 % of cells
    pass at 5°. The literal "P95 of the whole cell ≤ θ" stays available as a strict option.
23. **One scoring model everywhere.** The old per-site scorer (`config/factors/score/explain.ts`) was removed. Named
    sites, your points, the heatmap and the top 3 all use the cell model.
24. **Per-factor σ = sub-weight-averaged input σ** (not the weakest input), so simulated boulders lower confidence
    in proportion to their 20 % share of safety instead of forcing every score to "low".
25. **Full-grid scoring (~75 ms) runs on the main thread with `useDeferredValue`.** Sliders stay responsive and the
    heatmap / top 3 catch up. Point explanations use the live (non-deferred) weights.
26. **Suitability colours:** dark green / light yellow / red-orange differ in lightness too. Poor cells are dotted
    and excluded cells hatched, and the legend shows ✓ ~ ✗ ⛔ symbols, so colour is never the only cue.
27. **Explanations of excluded cells never praise a factor that a failed gate contradicts.** For example, there is
    no "usable flat spot" after a slope failure.
28. **The layer list is collapsed by default.** When open it covered a third of the map, hiding the top-3 pins. The
    legend stays visible.
29. **Custom points inherit their 500 m cell's horizon** (90 × 4° bins) instead of a smooth sphere when inside
    the grid.
