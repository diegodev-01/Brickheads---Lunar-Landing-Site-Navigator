/** Reads the precomputed dataset committed under public/data (built by scripts/*.py). */
import type { EphemerisSeries, Provenance, Site } from "@/domain/types";
import type { LunarDataProvider, RegionMeta } from "../provider";

interface EphemerisFile {
  provenance: Provenance;
  source: string;
  start: string;
  stepHours: number;
  subSolarLon: number[];
  subSolarLat: number[];
  subEarthLon: number[];
  subEarthLat: number[];
  earthDistanceKm: number[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return (await res.json()) as T;
}

export class StaticDatasetProvider implements LunarDataProvider {
  constructor(private readonly baseUrl = "/data") {}

  getRegion(): Promise<RegionMeta> {
    return getJson<RegionMeta>(`${this.baseUrl}/region.json`);
  }

  async getSites(): Promise<Site[]> {
    const file = await getJson<{ sites: Site[] }>(`${this.baseUrl}/sites.json`);
    return file.sites;
  }

  async getEphemeris(): Promise<EphemerisSeries> {
    const f = await getJson<EphemerisFile>(`${this.baseUrl}/ephemeris.json`);
    return {
      startMs: Date.parse(f.start),
      stepMs: f.stepHours * 3_600_000,
      subSolarLon: f.subSolarLon,
      subSolarLat: f.subSolarLat,
      subEarthLon: f.subEarthLon,
      subEarthLat: f.subEarthLat,
      earthDistanceKm: f.earthDistanceKm,
      provenance: f.provenance,
      source: f.source,
    };
  }
}
