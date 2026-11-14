/** Reads the precomputed dataset committed under public/data (built by scripts/*.py). */
import type { AnalysisGrid } from "@/domain/grid/grid";
import { parseProvenanceKind } from "@/domain/provenance";
import type { EphemerisSeries, Site } from "@/domain/types";
import type { LunarDataProvider, RegionMeta } from "../provider";
import { decodeGrid, type GridManifest } from "./gridCodec";

interface EphemerisFile {
  provenance: string;
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

  async getRegion(): Promise<RegionMeta> {
    const region = await getJson<RegionMeta>(`${this.baseUrl}/region.json`);
    // Data files may carry legacy labels ("real" / "mock"); normalise at the boundary.
    return {
      ...region,
      layers: region.layers.map((l) => ({ ...l, provenance: parseProvenanceKind(l.provenance) })),
    };
  }

  async getSites(): Promise<Site[]> {
    const file = await getJson<{ sites: Site[] }>(`${this.baseUrl}/sites.json`);
    return file.sites.map((s) => ({ ...s, provenance: parseProvenanceKind(s.provenance) }));
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
      provenance: parseProvenanceKind(f.provenance),
      source: f.source,
    };
  }

  async getAnalysisGrid(): Promise<AnalysisGrid> {
    const manifest = await getJson<GridManifest>(`${this.baseUrl}/grid/grid.json`);
    const file = manifest.file ?? "grid.bin";
    const res = await fetch(`${this.baseUrl}/grid/${file}`);
    if (!res.ok || !res.body) throw new Error(`Failed to load ${file}: ${res.status}`);
    // .gz is stored pre-compressed (smaller repo); inflate with the native DecompressionStream.
    const bin = file.endsWith(".gz")
      ? await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
      : await res.arrayBuffer();
    return decodeGrid(manifest, bin);
  }
}
