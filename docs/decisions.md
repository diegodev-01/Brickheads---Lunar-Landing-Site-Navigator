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
   Every approximation errs toward *more* shadow, never less. Rays step 40 m out to 4 km, then grow 1.5 %/step
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
