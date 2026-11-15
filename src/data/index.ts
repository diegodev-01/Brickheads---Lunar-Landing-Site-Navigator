import type { LunarDataProvider } from "./provider";
import { StaticDatasetProvider } from "./static/staticProvider";

export type { LunarDataProvider, RasterLayerMeta, RegionMeta, FeatureLabel } from "./provider";

/**
 * Picks the data provider. Only "static" exists in the MVP; add e.g. "horizons-live" here later.
 * Set NEXT_PUBLIC_DATA_PROVIDER to choose.
 */
export function getDataProvider(): LunarDataProvider {
  const kind = process.env.NEXT_PUBLIC_DATA_PROVIDER ?? "static";
  switch (kind) {
    case "static":
      return new StaticDatasetProvider();
    default:
      throw new Error(`Unknown data provider: ${kind}`);
  }
}
