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

/** Pale → dark (yellow-orange-brown): low hazard to high hazard. Lightness-monotonic. */
export const HAZARD_PALETTE: Palette = {
  id: "hazard",
  stops: ["#fff7bc", "#fec44f", "#fe9929", "#d95f0e", "#993404", "#4a1a04"],
};

/** Black → purple → orange → pale yellow (magma-like): cold to hot. */
export const THERMAL_PALETTE: Palette = {
  id: "thermal",
  stops: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
};

/** Dark → teal → pale cyan (mako-like): dry to icy. */
export const ICE_PALETTE: Palette = {
  id: "ice",
  stops: ["#0b0405", "#382a54", "#395d9c", "#3496a9", "#60ceac", "#def5e5"],
};

/** Greys: radar backscatter ratio. */
export const RADAR_PALETTE: Palette = {
  id: "radar",
  stops: ["#111111", "#444444", "#777777", "#aaaaaa", "#dddddd", "#ffffff"],
};

/** Viridis: composition. */
export const MINERAL_PALETTE: Palette = {
  id: "mineral",
  stops: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
};

/**
 * Suitability classes. Green / yellow / red as requested, made colour-blind-safe by ALSO using
 * lightness (dark green vs light yellow) and patterns: poor = dot pattern, excluded = diagonal hatch.
 */
export const SUITABILITY = {
  good: { color: [27, 120, 55], label: "✓ Good (75+)" },
  possible: { color: [254, 224, 139], label: "~ Possible (55–75)" },
  poor: { color: [214, 96, 77], label: "✗ Poor (<55), dotted" },
  excluded: { color: [74, 82, 99], label: "⛔ Excluded, hatched" },
} as const;

/** Pixels per cell for patterned rendering. */
export const PATTERN_SCALE = 4;

/**
 * Paints suitability classes with patterns at PATTERN_SCALE px per cell.
 * score NaN + failed bitmask 0 < bits < 255 → excluded; 255 → not evaluated (transparent).
 */
export function paintSuitability(
  canvas: HTMLCanvasElement,
  g: GridGeometry,
  score: Float32Array,
  failed: Uint8Array,
  alpha = 230,
): HTMLCanvasElement {
  const k = PATTERN_SCALE;
  canvas.width = g.cols * k;
  canvas.height = g.rows * k;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const img = ctx.createImageData(canvas.width, canvas.height);
  const W = canvas.width;
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      const i = row * g.cols + col;
      const f = failed[i]!;
      if (f === 255) continue;
      const s = score[i]!;
      const cls = f !== 0 ? "excluded" : s >= 75 ? "good" : s >= 55 ? "possible" : "poor";
      const [r, gg, b] = SUITABILITY[cls].color;
      for (let py = 0; py < k; py++) {
        for (let px = 0; px < k; px++) {
          const X = col * k + px;
          const Y = row * k + py;
          const o = (Y * W + X) * 4;
          let a = alpha;
          let rr: number = r;
          let g2: number = gg;
          let bb: number = b;
          if (cls === "excluded") {
            // diagonal hatch: stripes every 4 px, gaps nearly transparent
            if ((X + Y) % 4 !== 0) a = 60;
          } else if (cls === "poor" && X % 4 === 1 && Y % 4 === 1) {
            rr = 40;
            g2 = 10;
            bb = 10; // dark dot
          }
          img.data[o] = rr;
          img.data[o + 1] = g2;
          img.data[o + 2] = bb;
          img.data[o + 3] = a;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
