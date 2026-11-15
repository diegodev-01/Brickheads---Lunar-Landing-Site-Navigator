"use client";

import "ol/ol.css";
import { useEffect, useRef } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { fromExtent } from "ol/geom/Polygon";
import ImageCanvasSource from "ol/source/ImageCanvas";
import ImageLayer from "ol/layer/Image";
import VectorLayer from "ol/layer/Vector";
import Static from "ol/source/ImageStatic";
import VectorSource from "ol/source/Vector";
import Projection from "ol/proj/Projection";
import { Circle, Fill, Stroke, Style, Text } from "ol/style";
import ScaleLine from "ol/control/ScaleLine";
import { defaults as defaultControls } from "ol/control/defaults";
import type { RegionMeta } from "@/data";
import type { Extent } from "@/domain/grid/grid";
import type { Site } from "@/domain/types";
import type { SiteScore } from "@/features/sites/SiteList";

interface Props {
  region: RegionMeta;
  sites: Site[];
  siteScores: Map<string, SiteScore>;
  /** Recommended zones: lettered pin at the pick plus the zone's cell squares. */
  zones?: { letter: string; x: number; y: number; cells: Extent[] }[];
  layerId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Called with projected metres when the user clicks empty ground (custom site). */
  onPickPoint: (x: number, y: number) => void;
  /** Grid heatmap (cols×rows canvas covering `extent`); replaces the static overlay when set. */
  gridOverlay?: { canvas: HTMLCanvasElement; extent: Extent; version: number } | null;
  /** Region of interest outline. */
  roi?: Extent | null;
}

export default function LunarMap({
  region,
  sites,
  siteScores,
  zones = [],
  layerId,
  selectedId,
  onSelect,
  onPickPoint,
  gridOverlay = null,
  roi = null,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const overlayRef = useRef<ImageLayer<Static> | null>(null);
  const projectionRef = useRef<Projection | null>(null);
  const sitesSrc = useRef(new VectorSource());
  const roiSrc = useRef(new VectorSource());
  const zonesSrc = useRef(new VectorSource());
  const gridSourceRef = useRef<ImageCanvasSource | null>(null);
  const gridRef = useRef(gridOverlay);
  const outCanvas = useRef<HTMLCanvasElement | null>(null);
  const callbacks = useRef({ onSelect, onPickPoint });

  useEffect(() => {
    callbacks.current = { onSelect, onPickPoint };
  }, [onSelect, onPickPoint]);

  // Build the map once per region.
  useEffect(() => {
    if (!el.current) return;
    const extent = region.extentM;
    const projection = new Projection({ code: region.projection.code, units: "m", extent });
    projectionRef.current = projection;
    const image = (url: string, opacity = 1) =>
      new ImageLayer({ source: new Static({ url, projection, imageExtent: extent }), opacity });

    const hill = region.layers.find((l) => l.id === "hillshade");
    const overlay = new ImageLayer<Static>({ opacity: 0.7 });
    overlayRef.current = overlay;

    // Heatmap: draws the small cols×rows grid canvas into the requested view extent, nearest-neighbour
    // so each 500 m cell stays a crisp square.
    const gridSource = new ImageCanvasSource({
      projection,
      ratio: 1,
      interpolate: false,
      canvasFunction: (ext, _res, _ratio, size) => {
        const out = (outCanvas.current ??= document.createElement("canvas"));
        out.width = size[0]!;
        out.height = size[1]!;
        const ctx = out.getContext("2d");
        const g = gridRef.current;
        if (!ctx || !g) return out;
        ctx.imageSmoothingEnabled = false;
        const [gx0, gy0, gx1, gy1] = g.extent;
        const sx = size[0]! / (ext[2]! - ext[0]!);
        const sy = size[1]! / (ext[3]! - ext[1]!);
        ctx.drawImage(
          g.canvas,
          (gx0 - ext[0]!) * sx,
          (ext[3]! - gy1) * sy,
          (gx1 - gx0) * sx,
          (gy1 - gy0) * sy,
        );
        return out;
      },
    });
    gridSourceRef.current = gridSource;
    const gridLayer = new ImageLayer({ source: gridSource, opacity: 0.8 });

    const labels = new VectorSource({
      features: region.features
        .filter((f) => f.diameterKm >= 4)
        .map((f) => new Feature({ geometry: new Point([f.x, f.y]), name: f.name })),
    });

    const map = new OlMap({
      target: el.current,
      controls: defaultControls({ attribution: false, rotate: false }).extend([
        new ScaleLine({ units: "metric" }),
      ]),
      layers: [
        ...(hill ? [image(hill.url)] : []),
        overlay,
        gridLayer,
        new VectorLayer({
          source: roiSrc.current,
          style: new Style({
            stroke: new Stroke({ color: "rgba(255,255,255,0.9)", width: 2, lineDash: [8, 6] }),
          }),
        }),
        new VectorLayer({
          source: labels,
          declutter: true,
          style: (f) =>
            new Style({
              text: new Text({
                text: f.get("name") as string,
                font: "italic 11px var(--font-geist-sans), sans-serif",
                fill: new Fill({ color: "rgba(230,233,240,0.75)" }),
                stroke: new Stroke({ color: "rgba(0,0,0,0.8)", width: 3 }),
              }),
            }),
        }),
        new VectorLayer({ source: zonesSrc.current, zIndex: 9 }),
        new VectorLayer({ source: sitesSrc.current, zIndex: 10 }),
      ],
      view: new View({
        projection,
        center: [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2],
        extent,
        constrainOnlyCenter: true,
        zoom: 2,
        minZoom: 1,
        maxZoom: 9,
      }),
    });
    map.getView().fit(extent, { padding: [16, 16, 16, 16] });

    map.on("singleclick", (e) => {
      const hit = map.forEachFeatureAtPixel(e.pixel, (f) => f.get("siteId") as string | undefined, {
        layerFilter: (l) => l.getSource() === sitesSrc.current,
        hitTolerance: 6,
      });
      if (hit) callbacks.current.onSelect(hit);
      else callbacks.current.onPickPoint(e.coordinate[0]!, e.coordinate[1]!);
    });
    map.on("pointermove", (e) => {
      const over = map.hasFeatureAtPixel(e.pixel, {
        layerFilter: (l) => l.getSource() === sitesSrc.current,
      });
      const target = map.getTargetElement();
      if (target) target.style.cursor = over ? "pointer" : "crosshair";
    });

    // Keep the canvas in sync when the surrounding grid resizes (panels open/close, window resize).
    const ro = new ResizeObserver(() => map.updateSize());
    ro.observe(el.current);

    mapRef.current = map;
    return () => {
      ro.disconnect();
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, [region]);

  // Grid heatmap: redraw when the data changes (scrubber frames arrive here at up to 60 fps).
  useEffect(() => {
    gridRef.current = gridOverlay;
    gridSourceRef.current?.changed();
  }, [gridOverlay]);

  useEffect(() => {
    roiSrc.current.clear();
    if (roi) roiSrc.current.addFeature(new Feature({ geometry: fromExtent(roi) }));
  }, [roi]);

  // Thematic overlay layer (static PNGs); hidden while a grid heatmap is shown.
  const hasGrid = gridOverlay !== null;
  useEffect(() => {
    const layer = overlayRef.current;
    const projection = projectionRef.current;
    if (!layer || !projection) return;
    const meta = hasGrid
      ? undefined
      : region.layers.find((l) => l.id === layerId && l.id !== "hillshade");
    layer.setSource(
      meta
        ? new Static({
            url: meta.url,
            projection,
            imageExtent: region.extentM,
          })
        : null,
    );
  }, [layerId, region, hasGrid]);

  // Site markers: small and neutral (the heatmap carries the colour), with a readiness symbol.
  useEffect(() => {
    const SYMBOL = { good: "✓", possible: "~", poor: "✗", excluded: "×" } as const;
    const [minX, minY, maxX, maxY] = region.extentM;
    const features = sites
      .filter((s) => s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY)
      .map((s) => {
        const r = siteScores.get(s.id);
        const sel = s.id === selectedId;
        const f = new Feature({ geometry: new Point([s.x, s.y]), siteId: s.id });
        f.setStyle(
          new Style({
            zIndex: sel ? 100 : 50,
            image: new Circle({
              radius: sel ? 11 : 7,
              fill: new Fill({ color: sel ? "#ffc94a" : "rgba(14,18,27,0.9)" }),
              stroke: new Stroke({
                color: sel ? "#ffffff" : "rgba(230,233,240,0.9)",
                width: sel ? 3 : 1.5,
              }),
            }),
            text: new Text({
              text: r?.readiness ? SYMBOL[r.readiness] : "",
              font: "bold 10px var(--font-geist-mono), monospace",
              fill: new Fill({ color: sel ? "#07090f" : "#e6e9f0" }),
            }),
          }),
        );
        return f;
      });
    sitesSrc.current.clear();
    sitesSrc.current.addFeatures(features);
  }, [sites, siteScores, selectedId, region]);

  // Recommended zones: outlined cells + big lettered pin.
  useEffect(() => {
    const feats: Feature[] = [];
    for (const z of zones) {
      for (const c of z.cells) {
        const f = new Feature({ geometry: fromExtent(c) });
        f.setStyle(
          new Style({
            fill: new Fill({ color: "rgba(255,255,255,0.12)" }),
            stroke: new Stroke({ color: "rgba(255,255,255,0.95)", width: 1.5 }),
          }),
        );
        feats.push(f);
      }
      const pin = new Feature({ geometry: new Point([z.x, z.y]) });
      pin.setStyle(
        new Style({
          zIndex: 200,
          image: new Circle({
            radius: 14,
            fill: new Fill({ color: "#ffc94a" }),
            stroke: new Stroke({ color: "#07090f", width: 3 }),
          }),
          text: new Text({
            text: z.letter,
            font: "bold 15px var(--font-geist-sans), sans-serif",
            fill: new Fill({ color: "#07090f" }),
          }),
        }),
      );
      feats.push(pin);
    }
    zonesSrc.current.clear();
    zonesSrc.current.addFeatures(feats);
  }, [zones]);

  // Pan to the selected site if it is off-screen.
  useEffect(() => {
    const map = mapRef.current;
    const site = sites.find((s) => s.id === selectedId);
    if (!map || !site) return;
    const view = map.getView();
    const ext = view.calculateExtent(map.getSize());
    if (site.x < ext[0]! || site.x > ext[2]! || site.y < ext[1]! || site.y > ext[3]!) {
      view.animate({ center: [site.x, site.y], duration: 300 });
    }
  }, [selectedId, sites]);

  return (
    <div
      ref={el}
      className="h-full w-full bg-black"
      aria-label="Map of the lunar south pole region"
    />
  );
}
