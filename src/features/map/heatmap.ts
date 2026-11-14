/**
 * Grid → canvas rendering for heatmap layers, with colour-vision-deficiency-safe palettes.
 * Sequential palettes vary monotonically in lightness, so they read correctly in greyscale and for
 * every common colour-vision deficiency. Every legend also states what each end MEANS in words.
 */
import type { GridGeometry } from "@/domain/grid/grid";

export interface Palette {
  id: string;
  /** Colour stops, evenly spaced from min to max. */
  stops: string[];
}

/** Dark → purple → orange → pale yellow (inferno-like): darkness to full sunlight. */
export const SUNLIGHT_PALETTE: Palette = {
  id: "sunlight",
  stops: ["#0b0b2b", "#4a1a6b", "#a3306a", "#e8632b", "#fbb43a", "#fcf3a3"],
};

/** Dark navy → blue → cyan → white: no Earth in view to Earth always in view. */
export const EARTH_PALETTE: Palette = {
  id: "earth",
  stops: ["#0b0b2b", "#173a74", "#1f6fb2", "#34a8d8", "#9fe0f2", "#effcff"],
};

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 256-entry RGB lookup table for a palette. */
export function paletteLut(p: Palette): Uint8ClampedArray {
  const rgb = p.stops.map(hexToRgb);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const pos = (i / 255) * (rgb.length - 1);
    const k = Math.min(rgb.length - 2, Math.floor(pos));
    const t = pos - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = rgb[k]![c]! * (1 - t) + rgb[k + 1]![c]! * t;
  }
  return lut;
}

/**
 * Paints per-cell values (grid order, row 0 at the top) into a cols×rows canvas.
 * NaN cells and cells outside `mask` (if given) are transparent.
 */
export function paintGrid(
  canvas: HTMLCanvasElement,
  g: GridGeometry,
  values: Float32Array,
  min: number,
  max: number,
  lut: Uint8ClampedArray,
  alpha = 255,
  mask?: Uint8Array,
): HTMLCanvasElement {
  canvas.width = g.cols;
  canvas.height = g.rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const img = ctx.createImageData(g.cols, g.rows);
  const span = max - min || 1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    const o = i * 4;
    if (Number.isNaN(v) || (mask && !mask[i])) {
      img.data[o + 3] = 0;
      continue;
    }
    const q = Math.max(0, Math.min(255, Math.round(((v - min) / span) * 255)));
    img.data[o] = lut[q * 3]!;
    img.data[o + 1] = lut[q * 3 + 1]!;
    img.data[o + 2] = lut[q * 3 + 2]!;
    img.data[o + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
