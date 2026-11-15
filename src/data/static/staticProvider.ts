/** Reads the precomputed dataset committed under public/data (built by scripts/*.py). */
import type { AnalysisGrid } from "@/domain/grid/grid";
import { parseProvenanceKind } from "@/domain/provenance";
import type { EphemerisSeries, Site } from "@/domain/types";
import type { LunarDataProvider, RegionMeta } from "../provider";
import { SENSOR_FIELD_IDS, type SensorFields } from "@/domain/sensors/sensors";
import { syntheticSensorFields } from "../synthetic/syntheticSensors";
import { decodeFields, decodeGrid, type FieldManifest, type GridManifest } from "./gridCodec";

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
  private gridPromise: Promise<AnalysisGrid> | null = null;

  constructor(private readonly baseUrl = "/data") {}

  /** Fetches a (possibly .gz) binary and inflates it with the native DecompressionStream. */
  private async getBinary(file: string, dir: string): Promise<ArrayBuffer> {
    const res = await fetch(`${this.baseUrl}/${dir}/${file}`);
    if (!res.ok || !res.body) throw new Error(`Failed to load ${file}: ${res.status}`);
    return file.endsWith(".gz")
      ? new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
      : res.arrayBuffer();
  }

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

  getAnalysisGrid(): Promise<AnalysisGrid> {
    this.gridPromise ??= (async () => {
      const manifest = await getJson<GridManifest>(`${this.baseUrl}/grid/grid.json`);
      return decodeGrid(manifest, await this.getBinary(manifest.file ?? "grid.bin", "grid"));
    })();
    return this.gridPromise;
  }

  async getSensorFields(): Promise<SensorFields> {
    try {
      const manifest = await getJson<FieldManifest & { file: string }>(
        `${this.baseUrl}/sensors/sensors.json`,
      );
      const buf = await this.getBinary(manifest.file, "sensors");
      return decodeFields(manifest, buf, SENSOR_FIELD_IDS);
    } catch (e) {
      console.warn("Sensor data unavailable, using SIMULATED fallback:", e);
      return syntheticSensorFields(await this.getAnalysisGrid());
    }
  }
}
