"use client";

import "ol/ol.css";
import { useEffect, useRef } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import ImageLayer from "ol/layer/Image";
import VectorLayer from "ol/layer/Vector";
import Static from "ol/source/ImageStatic";
import VectorSource from "ol/source/Vector";
import Projection from "ol/proj/Projection";
import { Circle, Fill, Stroke, Style, Text } from "ol/style";
import ScaleLine from "ol/control/ScaleLine";
import { defaults as defaultControls } from "ol/control/defaults";
import type { RegionMeta } from "@/data";
import type { RankedSite } from "@/domain/scoring/score";
import type { Site } from "@/domain/types";
import { scoreColor } from "@/components/ui/scoreColor";

interface Props {
  region: RegionMeta;
  sites: Site[];
  ranking: RankedSite[];
  layerId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Called with projected metres when the user clicks empty ground (custom site). */
  onPickPoint: (x: number, y: number) => void;
}

export default function LunarMap({
  region,
  sites,
  ranking,
  layerId,
  selectedId,
  onSelect,
  onPickPoint,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const overlayRef = useRef<ImageLayer<Static> | null>(null);
  const projectionRef = useRef<Projection | null>(null);
  const sitesSrc = useRef(new VectorSource());
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

  // Thematic overlay layer.
  useEffect(() => {
    const layer = overlayRef.current;
    const projection = projectionRef.current;
    if (!layer || !projection) return;
    const meta = region.layers.find((l) => l.id === layerId && l.id !== "hillshade");
    layer.setSource(
      meta
        ? new Static({
            url: meta.url,
            projection,
            imageExtent: region.extentM,
          })
        : null,
    );
  }, [layerId, region]);

  // Site markers, coloured by score and labelled with rank.
  useEffect(() => {
    const byId = new Map(ranking.map((r) => [r.siteId, r]));
    const [minX, minY, maxX, maxY] = region.extentM;
    const features = sites
      .filter((s) => s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY)
      .map((s) => {
        const r = byId.get(s.id);
        const sel = s.id === selectedId;
        const nogo = (r?.flags.length ?? 0) > 0;
        const f = new Feature({ geometry: new Point([s.x, s.y]), siteId: s.id });
        f.setStyle(
          new Style({
            zIndex: sel ? 100 : 100 - (r?.rank ?? 99),
            image: new Circle({
              radius: sel ? 13 : 10,
              fill: new Fill({ color: nogo ? "#4a5263" : scoreColor(r?.score ?? 0) }),
              stroke: new Stroke({
                color: sel ? "#ffffff" : "rgba(0,0,0,0.85)",
                width: sel ? 3 : 1.5,
              }),
            }),
            text: new Text({
              text: nogo ? "×" : String(r?.rank ?? ""),
              font: "bold 11px var(--font-geist-mono), monospace",
              fill: new Fill({ color: "#07090f" }),
            }),
          }),
        );
        return f;
      });
    sitesSrc.current.clear();
    sitesSrc.current.addFeatures(features);
  }, [sites, ranking, selectedId, region]);

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
