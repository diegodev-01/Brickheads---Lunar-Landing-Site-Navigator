/** Core domain types. Pure data: no framework types allowed in this layer. */

/** Where a value comes from. Shown in the UI so mock data is never mistaken for real data. */
export type Provenance = "real" | "derived" | "mock";

export interface LonLat {
  /** East longitude, degrees, [0, 360). */
  lon: number;
  /** Latitude, degrees, [-90, 90]. */
  lat: number;
}

/** Terrain horizon: max terrain elevation angle per azimuth bin (azimuth clockwise from local north). */
export interface HorizonMask {
  startAzDeg: number;
  stepDeg: number;
  elevationDeg: number[];
}

export type SiteKind = "candidate" | "reference" | "custom";

export interface Site extends LonLat {
  id: string;
  name: string;
  kind: SiteKind;
  /** Polar stereographic coordinates (m). */
  x: number;
  y: number;
  elevationM?: number;
  slopeMeanDeg?: number;
  slopeMaxDeg?: number;
  roughnessDeg?: number;
  psrDistanceKm?: number;
  inPsr?: boolean;
  longTermSunPct?: number;
  longTermEarthPct?: number;
  /** Missing => smooth-sphere horizon (0°), e.g. custom coordinates outside the precomputed region. */
  horizon?: HorizonMask;
  provenance: Provenance;
}

/** Hourly (or other fixed-step) geometry of the Sun and Earth relative to the Moon body frame. */
export interface EphemerisSeries {
  startMs: number;
  stepMs: number;
  subSolarLon: number[];
  subSolarLat: number[];
  subEarthLon: number[];
  subEarthLat: number[];
  earthDistanceKm: number[];
  provenance: Provenance;
  source: string;
}

export interface TimeWindow {
  startMs: number;
  endMs: number;
}

export interface SkyPosition {
  azimuthDeg: number;
  elevationDeg: number;
}

export type Body = "sun" | "earth";

/** Per-site, per-body visibility over the selected window. */
export interface BodyVisibility {
  body: Body;
  /** Sample times (ms since epoch). */
  times: number[];
  azimuthDeg: number[];
  elevationDeg: number[];
  /** Terrain horizon elevation at the body's azimuth for each sample. */
  horizonDeg: number[];
  visible: boolean[];
  /** Fraction of samples with the body's centre above the terrain horizon, 0..1. */
  fraction: number;
  /** Hours from window start until the next visibility change (sunset/earthset or rise); null if none in window. */
  hoursToChange: number | null;
  /** Whether the body is visible at the window start. */
  visibleAtStart: boolean;
  /** Longest continuous NOT-visible stretch in hours (e.g. longest night / comms blackout). */
  longestGapHours: number;
  meanElevationWhenVisibleDeg: number | null;
}

export interface SiteConditions {
  siteId: string;
  sun: BodyVisibility;
  earth: BodyVisibility;
}
