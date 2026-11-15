# Scoring and recommendation model

Status: **approved and implemented** (2026-11-14) in `src/domain/scoring/` (`piecewise.ts`, `model.ts`,
`evaluate.ts`, `grid.ts`, `explainCell.ts`). These are pure functions with no React/Next imports, and
`cellScoring.test.ts` covers every edge case in §8.

All thresholds are **illustrative defaults for a small robotic lander, not mission requirements**. Every one
of them is a configurable parameter (`ScoringConfig`).

---

## 1. Inputs per 500 m cell

| Symbol               | Meaning                                                                    | Source (provenance)                           |
| -------------------- | -------------------------------------------------------------------------- | --------------------------------------------- |
| `r_safe(θ)`          | radius of the largest circle in the cell where 40 m slope ≤ θ (m)          | LOLA LDSM (derived, **new grid field**, §2.1) |
| `ρ`                  | roughness: std-dev of 40 m slope in the cell (°)                           | LOLA (derived)                                |
| `b`                  | boulder hazard index 0–1                                                   | model (SIMULATED, low)                        |
| `s_P95`              | 95th-percentile slope in the cell (°)                                      | LOLA LDSM (measured)                          |
| `f_sun`              | mean visible solar-disc fraction over the mission window, 0–1              | Horizons + LOLA horizon (derived)             |
| `N_sun`              | longest stretch with < 50 % of the disc visible (h)                        | same (derived)                                |
| `f_dte`              | mean fraction of the window with Earth above the terrain, 0–1              | Horizons + LOLA horizon (derived)             |
| `G_dte`              | longest Earth blackout (h)                                                 | same (derived)                                |
| `f_relay`, `G_relay` | relay contact fraction and longest relay gap (added with the relay module) | relay model (SIMULATED)                       |
| `d_psr`              | distance to the nearest permanently shadowed 100 m pixel (km)              | LOLA LPSR (derived)                           |
| `I_2km`              | max ice-probability index within 2 km of the cell                          | Diviner + LOLA + Mini-RF model (SIMULATED)    |

## 2. Stage 1: hard gates

A cell is **excluded** if any enabled gate fails. Each failure is recorded as `{gate, value, threshold, provenance}`
and shown to the user, e.g. _"Excluded: no flat spot ≥ 100 m radius (largest is 40 m at ≤ 5°)"_.

| Gate         | Fails when                                                               | Default                   | Notes                                                         |
| ------------ | ------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------- |
| G1 Slope     | `r_safe(θ) < R_ellipse`                                                  | θ = **5°**, R = **100 m** | see §2.1, the key decision for this review                    |
| G2 Roughness | `ρ > ρ_max`                                                              | **4°**                    | excludes the roughest ~4 % of cells                           |
| G3 Boulders  | `b > b_max`                                                              | **0.6**                   | input is SIMULATED, so the failure is tagged "simulated gate" |
| G4 Comms     | no DTE **and** no relay contact in the window: `f_dte = 0 ∧ f_relay = 0` | on                        | until the relay module lands: `f_dte = 0`                     |
| G5 Darkness  | `f_sun = 0` over the window                                              | **off**                   | optional; preset-dependent (a science lander may accept it)   |

### 2.1 Why the slope gate is lander-scale (conflict with a literal reading of the brief)

Measured on the real grid:

- **"95th-percentile slope of the 500 m cell ≤ 5°"** keeps only **4 %** of cells, and **none** of them gets
  more than 30 % long-term sunlight. The well-lit ridges all have steep patches somewhere in a 500 m cell.
  The top 3 would then land in the dark, which is a bad recommendation.
- A lander needs a flat **landing ellipse** (~100 m radius for precision landing), not a flat 500 m square.
  **"The cell contains a circle of radius ≥ 100 m where every 40 m slope sample ≤ 5°"** keeps **33 %** of cells,
  including **720** with > 30 % long-term sunlight.

**Recommendation:** use the lander-scale gate. It keeps the brief's 5° number and applies it at the scale where
it is meaningful. Implementation: `build_grid.py` adds `safeRadius5`, `safeRadius8`, `safeRadius10` and
`safeRadius15` (distance transform of the slope ≤ θ mask, max per cell, 10 m steps, u8). The UI then offers θ
∈ {5, 8, 10, 15}° and a free R. A literal "P95 ≤ θ" mode stays available as an option.

## 3. Stage 2: weighted soft score

Each factor is normalized to 0–1 with a **piecewise-linear function** `PL(x; (x₀,y₀), (x₁,y₁), …)`: linear
between breakpoints and clamped outside them. Breakpoints are config.

### 3.1 Safety `n_safe`

```
n_safe = 0.5·PL(r_safe(θ); (R,0.4), (2R,0.8), (4R,1))     bigger flat area = more margin
       + 0.3·PL(ρ;        (1,1), (2,0.7), (ρ_max,0))
       + 0.2·PL(b;        (0,1), (b_max,0))
```

### 3.2 Science value `n_sci`

```
n_sci = 0.6·PL(d_psr; (0.5,1), (2,0.6), (5,0.1), (10,0))   rover-reachable cold trap
      + 0.4·PL(I_2km; (0,0), (0.5,0.8), (1,1))             likely surface ice nearby
```

### 3.3 Connectivity `n_comm`

```
f_c = max(f_dte, f_relay)     G_c = min(G_dte, G_relay)
n_comm = 0.6·PL(f_c; (0,0), (0.3,0.5), (0.7,0.9), (1,1))
       + 0.4·PL(G_c; (0,1), (24,0.8), (72,0.5), (168,0.2), (336,0))
```

### 3.4 Power and thermal `n_pow`

```
n_pow = 0.6·PL(f_sun; (0,0), (0.5,0.6), (0.8,0.9), (1,1))
      + 0.4·PL(N_sun; (0,1), (48,0.8), (100,0.4), (200,0))     longest night drives battery mass
```

### 3.5 Weights, presets and the score

`w = (w_safe, w_sci, w_comm, w_pow)`, with every `wᵢ ≥ 0` and `Σwᵢ = 1`. A user edit to one slider rescales the
others proportionally, so the sum stays 1. If every weight is 0, the preset weights are restored.

| Preset             | safety | science | comms | power |
| ------------------ | -----: | ------: | ----: | ----: |
| Balanced (default) |   0.35 |    0.20 |  0.20 |  0.25 |
| Safety-first       |   0.55 |    0.10 |  0.15 |  0.20 |
| Science-first      |   0.25 |    0.45 |  0.10 |  0.20 |
| Comms-first        |   0.25 |    0.10 |  0.45 |  0.20 |

```
score = 100 · Σ wᵢ · nᵢ        (only for cells that pass all gates; excluded cells have no score)
contributionᵢ = 100 · wᵢ · nᵢ  (points, sums to the score)
```

## 4. Uncertainty

Each input carries a 1-σ uncertainty from its provenance: high → 0.05, medium → 0.12, low (or simulated) → 0.25,
in normalized units. A factor's σ is the **sub-weight-averaged** σ of its inputs. For example, safety =
0.5·σ(radius) + 0.3·σ(roughness) + 0.2·σ(boulders). (The draft used the _weakest_ input. That marked every
safety score low-confidence because boulders are simulated, so the indicator said nothing. Logged in
decisions.md #24.) Assuming independent factors:

```
σ_score = 100 · sqrt( Σ (wᵢ · σᵢ)² )
confidence = high if σ_score < 5, medium if < 10, else low
```

Shown as **"82 ± 6 (medium confidence)"**. Gates fed by SIMULATED inputs (G3) are flagged in the explanation.

## 5. Top-3 zones: spatial non-maximum suppression

1. Candidates = passing cells inside the ROI, sorted by score (ties broken by lower `σ_score`, then by cell index,
   so the result is deterministic).
2. Greedy: take the best candidate, then skip every candidate within **`D_min` = 3 km** (centre to centre) of an
   already chosen pick. Repeat until 3 picks are made or candidates run out.
3. **Zone** = the pick plus the connected passing cells within 1 km whose score is ≥ pick − 5 (shown as an
   outline: "a 1.2 km² area of good landing ground").
4. Fewer than 3 picks → say so plainly (_"Only 2 separate safe zones in this area: try a larger search area or relax
   the slope limit"_).

## 6. Explanation

Every recommendation returns:

```ts
{
  cell, rank, score, sigma, confidence,
  readiness: "good" | "possible" | "poor" | "excluded",   // ≥ 75 · 55–75 · < 55 · failed gate
  factors: [{ id, label, raw: {…}, normalized, weight, points, provenance }],   // sorted by points
  gates:   [{ id, passed, value, threshold, simulated }],
  sentence: string,      // from templates
  reasons:  string[],    // 3–4 plain-language bullets for the readiness summary
}
```

**Templates** (filled from the factor with the most points and the one losing the most):

- Headline: `good` → "Good landing candidate" · `possible` → "Possible landing site, with trade-offs" · `poor` →
  "Poor landing candidate" · `excluded` → "Not safe to land here".
- Sentence: "{Zone A} scores {82 ± 6}: {best-factor phrase} and {second phrase}; the main drawback is {worst phrase}."
- Factor phrases (by normalized level ≥ 0.75 / ≥ 0.4 / below):
  - safety: "a {340} m-wide flat area" / "a small but usable flat spot" / "only a marginal flat spot"
  - power: "sunlit {78} % of the window" / "sunlit about half the time" / "long nights (up to {5.2} days)"
  - comms: "Earth in view {64} % of the time" / "intermittent Earth contact" / "long blackouts (up to {3} days)"
  - science: "a cold trap {0.4} km away" / "a cold trap within {2} km" / "no cold trap nearby"

## 7. Readiness summary (one region or one point)

Headline + 3–4 reasons (the strongest positive, the biggest drawback, the gate status, and the data confidence),
for example:

> **Good landing candidate** · medium confidence
>
> - ☀ Sunlit 78 % of your window; longest night 31 h
> - 🛰 Earth in view 64 % of the time
> - ⚠ Flat area is small (120 m radius at ≤ 5°)
> - ◇ Boulder hazard is simulated (no boulder map at this resolution)

## 8. Unit tests (edge cases)

- `PL`: below the first breakpoint, above the last, exactly on a breakpoint, a single breakpoint, non-monotonic input rejected.
- Gates: a value exactly at the threshold passes; NaN input fails "no data" (it is never silently passed);
  disabled gates are ignored; multiple failures are all reported.
- Weights: sum to 1 after any edit; all-zero restores the preset; negative values are clamped to 0.
- Score: all factors at 1 → 100; contributions sum to the score; an excluded cell has no score.
- Uncertainty: all-high inputs → high confidence; a single low-confidence factor with weight 1 → σ = 25.
- NMS: picks are ≥ D_min apart; ties are deterministic; fewer than 3 candidates; empty ROI; ROI at the grid edge.
- Explanations: the sentence names the top and worst factors; an excluded cell names every failed gate.

## 9. Sensors: simulated models (already implemented, `src/domain/sensors/sensors.ts`)

These fill gaps where no verified dataset exists. Every output is tagged SIMULATED.

| Model               | Formula                                                                                                                                                                   | Why                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Boulder hazard `b`  | `0.7·PL(ρ; (1,0),(6,1)) + 0.3·PL(s_P95; (5,0),(25,1))`                                                                                                                    | no polar boulder / rock-abundance map verified |
| Temperature now     | `Tavg + (Tmax − Tavg)·f_sun(t)` (Diviner annual mean/max)                                                                                                                 | shows day/night contrast; no thermal inertia   |
| Hydrogen (ppm)      | `100 + 150·iceStableFraction`                                                                                                                                             | LEND / LP-NS maps not verified                 |
| Ice probability `I` | `0.55·surfaceStable + 0.15·PL(iceDepth; (0,1),(0.5,0)) + 0.20·psrFraction + 0.10·PL(CPR; (0.6,0),(1.2,1))`, renormalised over available inputs; High ≥ 0.5, Medium ≥ 0.25 | combines Diviner, LOLA, Mini-RF                |
