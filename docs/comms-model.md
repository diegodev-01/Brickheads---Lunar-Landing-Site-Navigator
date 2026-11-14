# Relay comms model (SIMULATED)

Code: `src/domain/comms/relay.ts` (orbit, geometry, link budget, contact windows) and
`src/domain/comms/relayGrid.ts` (per-cell contact over the window, point series). Tests: `relay.test.ts`.

Every relay number in the UI is tagged **Simulated**: there is no real relay ephemeris in this app.

## Orbit

A relay in a **southern 9:2 Near-Rectilinear Halo Orbit** (the Gateway orbit family) dwells high above the
south pole for most of each ~6.56-day period. The MVP propagates a **two-body Keplerian ellipse** around the Moon:

| Parameter       | Value                                           | Notes                                                    |
| --------------- | ----------------------------------------------- | -------------------------------------------------------- |
| period          | 6.56 d                                          | 9:2 lunar synodic resonance                              |
| perilune radius | 1737.4 + 3100 km                                | ~3,100 km altitude, over the **north** pole              |
| semi-major axis | from the period (Kepler III)                    | ≈ 34,000 km; apolune ≈ 63,000 km over the **south** pole |
| orbit plane     | contains the spin axis, far-side longitude 180° | the L2 side                                              |
| phase           | perilune at 2026-11-01 00:00 UTC                | arbitrary: a real mission would publish its ephemeris    |

**Limits (known and accepted for the MVP):** a real NRHO is a three-body orbit. The Keplerian proxy matches its
period and its "high over the south pole" geometry, but positions can be off by thousands of km. The orbit plane
does not librate or precess. The relay is never eclipsed (no power model) and has no station-keeping gaps.

## Line of sight (per cell)

For each 500 m cell and time sample, the relay's topocentric elevation is compared with the cell's **terrain
horizon** at the relay's azimuth (the same ray-cast LOLA horizon used for sunlight). A sample counts as
**contact** when:

1. relay elevation − terrain horizon ≥ **minClearanceDeg = 2°** (antenna pattern / multipath margin), and
2. the relay can see Earth (the relay→Earth segment does not cross the Moon).

Outputs per cell: contact share of the window, and the longest gap (h). The scoring engine uses
`max(DTE, relay)` for connectivity and passes the comms gate if either link exists (scoring-model.md §2–3).

## Contact windows, latency, data rate (selected point, 10-minute step)

- **Contact windows**: consecutive contact samples, each with its peak clearance. Shown with
  **minutes per orbit** = total contact × (period / window span).
- **One-way latency** = (lander→relay range + relay→Earth range) / c. Light time only, with no processing or
  queueing. Typical: 1.2–1.6 s, dominated by the Earth–Moon leg.
- **Band is a parameter, not a magic number** (`BANDS` in `relay.ts`). Illustrative small-lander proximity-link
  values:

| Band | f (GHz) | lander EIRP (dBW) | relay G/T (dB/K) | req. Eb/N0 (dB) | margin (dB) |
| ---- | ------: | ----------------: | ---------------: | --------------: | ----------: |
| S    |     2.2 |                10 |               −5 |             2.5 |           3 |
| X    |     8.4 |                17 |                5 |             2.5 |           3 |
| Ka   |      26 |                25 |               15 |             2.5 |           3 |

`FSPL = 20·log10(d km) + 20·log10(f GHz) + 92.45`; `C/N0 = EIRP + G/T − FSPL + 228.6`;
`rate = 10^((C/N0 − Eb/N0 − margin)/10)` bit/s, evaluated at the mean contact range.

## Shadow zones

Cells where the relay is hidden by terrain (deep crater floors, the far side of tall massifs) appear dark in the
**Relay contact** layer. If Earth is also hidden, the comms hard gate excludes them.
