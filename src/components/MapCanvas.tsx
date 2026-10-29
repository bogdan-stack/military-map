"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import maplibregl, { type GeoJSONSource, type Map } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { circlePolygon, rectPolygon } from "@/lib/geo";
import { useMapStore } from "@/lib/store";
import { affiliationColor, renderSymbol } from "@/lib/symbols";
import type { Graphic } from "@/lib/types";

const STYLES: Record<string, string | maplibregl.StyleSpecification> = {
  terrain: "https://tiles.openfreemap.org/styles/liberty",
  streets: "https://tiles.openfreemap.org/styles/bright",
  satellite: {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      satellite: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution: "Esri, Maxar, Earthstar Geographics",
      },
    },
    layers: [{ id: "satellite", type: "raster", source: "satellite" }],
  },
};

function layerVisible(graphic: Graphic, layers: { id: string; visible: boolean }[]) {
  return layers.find((layer) => layer.id === graphic.layerId)?.visible !== false;
}

function outlineOf(graphic: Graphic): [number, number][] {
  if (graphic.kind === "rect" && graphic.coordinates.length >= 2) {
    return rectPolygon(graphic.coordinates[0], graphic.coordinates[1]);
  }
  if (graphic.kind === "circle" && graphic.coordinates.length >= 2) {
    return circlePolygon(graphic.coordinates[0], graphic.coordinates[1]);
  }
  if (graphic.kind === "area" && graphic.coordinates.length >= 3) {
    const ring = graphic.coordinates;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) return [...ring, first];
    return ring;
  }
  return graphic.coordinates;
}

function isArea(graphic: Graphic) {
  return graphic.kind === "area" || graphic.kind === "rect" || graphic.kind === "circle";
}

function isLine(graphic: Graphic) {
  return graphic.kind === "line" || isArea(graphic);
}

function labelPoint(coords: [number, number][]): [number, number] {
  if (!coords.length) return [0, 0];
  const lng = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
  const lat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
  return [lng, lat];
}

function strokeOf(graphic: Graphic) {
  return graphic.renderer === "generic" ? graphic.color : affiliationColor(graphic.affiliation);
}

export function MapCanvas({ mapRef }: { mapRef: MutableRefObject<Map | null> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const markers = useRef(new globalThis.Map<string, maplibregl.Marker>());
  const { state, dispatch } = useMapStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  const styleKey = state.options.mapType;
  const styled = useRef(false);

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: hostRef.current,
      style: STYLES.terrain,
      center: [10, 20],
      zoom: 2.2,
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;

    map.on("load", () => {
      tint(map);
      ensureLayers(map);
      map.resize();
    });
    map.on("style.load", () => {
      tint(map);
      ensureLayers(map);
      draw(map, stateRef.current, markers.current, dispatch);
    });
    map.on("click", (event) => {
      const current = stateRef.current;
      const hits = map.queryRenderedFeatures(event.point, {
        layers: ["graphics-fill", "graphics-line", "graphics-dashed"].filter((id) => map.getLayer(id)),
      });
      if (hits.length && !current.placing && !current.options.measure) {
        const id = hits[0].properties?.id;
        if (typeof id === "string") {
          dispatch({ type: "select", id });
          return;
        }
      }
      dispatch({ type: "map-click", lng: event.lngLat.lng, lat: event.lngLat.lat });
    });
    map.on("dblclick", (event) => {
      const placing = stateRef.current.placing;
      if (!placing) return;
      const kind = placing.mode === "symbol" ? placing.symbol.kind : placing.kind;
      if (kind === "point" || kind === "pin" || kind === "text") return;
      event.preventDefault();
      dispatch({ type: "finish-draft" });
    });
    map.on("mousemove", (event) => {
      if (!stateRef.current.options.cursorCoordinate) return;
      dispatch({ type: "cursor", lngLat: [event.lngLat.lng, event.lngLat.lat] });
    });
    map.on("mouseout", () => dispatch({ type: "cursor", lngLat: null }));
    map.on("moveend", () => {
      if (!map.getSource("grid")) return;
      setData(
        map,
        "grid",
        stateRef.current.options.grid ? graticule(map) : { type: "FeatureCollection", features: [] },
      );
    });

    const host = hostRef.current;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      markers.current.forEach((marker) => marker.remove());
      markers.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // The map instance lives for the lifetime of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!styled.current) {
      styled.current = true;
      return;
    }
    map.setStyle(STYLES[styleKey] || STYLES.terrain);
  }, [mapRef, styleKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const placing = state.placing;
    const kind = placing ? (placing.mode === "symbol" ? placing.symbol.kind : placing.kind) : null;
    const multi = kind && kind !== "point" && kind !== "pin" && kind !== "text";
    if (multi) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [mapRef, state.placing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    draw(map, state, markers.current, dispatch);
  }, [
    dispatch,
    mapRef,
    state.draft,
    state.graphics,
    state.layers,
    state.measurePts,
    state.options,
    state.selectedId,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!state.options.showScale) return;
    const control = new maplibregl.ScaleControl({
      unit: state.options.distanceUnit === "imperial" ? "imperial" : "metric",
    });
    map.addControl(control, "bottom-left");
    return () => {
      try {
        map.removeControl(control);
      } catch {
        /* map already removed */
      }
    };
  }, [mapRef, state.options.distanceUnit, state.options.showScale]);

  const filter = `brightness(${1 + state.options.brightness / 100}) hue-rotate(${state.options.hue}deg) saturate(${state.options.chroma / 100})`;

  return <div ref={hostRef} className="map-host" style={{ filter }} />;
}

function tint(map: Map) {
  const layers = map.getStyle()?.layers || [];
  for (const layer of layers) {
    const id = layer.id.toLowerCase();
    try {
      if (layer.type === "background") map.setPaintProperty(layer.id, "background-color", "#d5f1ee");
      if (layer.type === "fill" && /water|ocean/.test(id)) map.setPaintProperty(layer.id, "fill-color", "#8ed4ea");
      if (layer.type === "fill" && /landcover|park|grass|wood|sand/.test(id)) {
        map.setPaintProperty(layer.id, "fill-color", "#e7f3e4");
      }
    } catch {
      /* some layers reject a color override */
    }
  }
}

function ensureLayers(map: Map) {
  const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
  for (const id of ["grid", "measure", "draft", "graphics"]) {
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: empty });
  }
  if (!map.getLayer("grid-line")) {
    map.addLayer({
      id: "grid-line",
      type: "line",
      source: "grid",
      paint: { "line-color": "#222", "line-width": 1, "line-opacity": 0.45 },
    });
  }
  if (!map.getLayer("graphics-fill")) {
    map.addLayer({
      id: "graphics-fill",
      type: "fill",
      source: "graphics",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.18 },
    });
  }
  if (!map.getLayer("graphics-line")) {
    map.addLayer({
      id: "graphics-line",
      type: "line",
      source: "graphics",
      filter: ["all", ["!=", ["geometry-type"], "Point"], ["!=", ["get", "dashed"], 1]],
      paint: {
        "line-color": ["case", ["==", ["get", "selected"], 1], "#e65100", ["get", "color"]],
        "line-width": ["case", ["==", ["get", "selected"], 1], 3.5, 2],
      },
    });
  }
  if (!map.getLayer("graphics-dashed")) {
    map.addLayer({
      id: "graphics-dashed",
      type: "line",
      source: "graphics",
      filter: ["all", ["!=", ["geometry-type"], "Point"], ["==", ["get", "dashed"], 1]],
      paint: {
        "line-color": ["case", ["==", ["get", "selected"], 1], "#e65100", ["get", "color"]],
        "line-width": ["case", ["==", ["get", "selected"], 1], 3.5, 2],
        "line-dasharray": [2, 1.4],
      },
    });
  }
  if (!map.getLayer("graphics-label")) {
    map.addLayer({
      id: "graphics-label",
      type: "symbol",
      source: "graphics",
      filter: ["==", ["geometry-type"], "Point"],
      layout: {
        "text-field": ["get", "label"],
        "text-size": 12,
        "text-font": ["Noto Sans Regular"],
        "text-offset": [0, 0.6],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#111",
        "text-halo-color": "#fff",
        "text-halo-width": 1.2,
      },
    });
  }
  if (!map.getLayer("draft-line")) {
    map.addLayer({
      id: "draft-line",
      type: "line",
      source: "draft",
      paint: { "line-color": "#e65100", "line-width": 2, "line-dasharray": [1.2, 1] },
    });
  }
  if (!map.getLayer("measure-line")) {
    map.addLayer({
      id: "measure-line",
      type: "line",
      source: "measure",
      paint: { "line-color": "#111", "line-width": 2 },
    });
  }
}

function setData(map: Map, id: string, data: FeatureCollection) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  source?.setData(data);
}

function draw(
  map: Map,
  state: ReturnType<typeof useMapStore>["state"],
  markers: globalThis.Map<string, maplibregl.Marker>,
  dispatch: ReturnType<typeof useMapStore>["dispatch"],
) {
  if (!map.getSource("graphics")) return;
  const features: FeatureCollection["features"] = [];
  const live = new Set<string>();

  for (const graphic of state.graphics) {
    if (!layerVisible(graphic, state.layers) || graphic.coordinates.length === 0) continue;
    const selected = state.selectedId === graphic.id ? 1 : 0;
    const color = strokeOf(graphic);
    const dashed = graphic.status === "A" ? 1 : 0;
    const label = [graphic.modifiers.uniqueDesignation, graphic.name].filter(Boolean).join(" · ");

    if (graphic.kind === "point" || graphic.kind === "pin" || graphic.kind === "text") {
      live.add(graphic.id);
      upsertMarker(map, markers, graphic, state, selected === 1, dispatch);
      continue;
    }

    if (isLine(graphic) && outlineOf(graphic).length >= 2) {
      const ring = outlineOf(graphic);
      if (isArea(graphic) && ring.length >= 4) {
        features.push({
          type: "Feature",
          properties: { id: graphic.id, color, selected, dashed, label: "" },
          geometry: { type: "Polygon", coordinates: [ring] },
        });
      } else {
        features.push({
          type: "Feature",
          properties: { id: graphic.id, color, selected, dashed, label: "" },
          geometry: { type: "LineString", coordinates: ring },
        });
      }
      features.push({
        type: "Feature",
        properties: { id: graphic.id, color, selected, dashed, label },
        geometry: { type: "Point", coordinates: labelPoint(ring) },
      });
    }
  }

  for (const [id, marker] of markers) {
    if (!live.has(id)) {
      marker.remove();
      markers.delete(id);
    }
  }

  setData(map, "graphics", { type: "FeatureCollection", features });
  setData(map, "draft", lineCollection(state.draft, "#e65100"));
  setData(map, "measure", lineCollection(state.measurePts, "#111"));
  setData(map, "grid", state.options.grid ? graticule(map) : { type: "FeatureCollection", features: [] });
}

function lineCollection(coords: [number, number][], color: string): FeatureCollection {
  if (coords.length < 2) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { color },
        geometry: { type: "LineString", coordinates: coords },
      },
    ],
  };
}

function upsertMarker(
  map: Map,
  markers: globalThis.Map<string, maplibregl.Marker>,
  graphic: Graphic,
  state: ReturnType<typeof useMapStore>["state"],
  selected: boolean,
  dispatch: ReturnType<typeof useMapStore>["dispatch"],
) {
  const locked = state.layers.find((layer) => layer.id === graphic.layerId)?.locked;
  const element = document.createElement("div");
  element.className = `symbol-marker${selected ? " selected" : ""}`;
  let anchor:
    | "center"
    | "top"
    | "bottom"
    | "left"
    | "right"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right" = "bottom";
  let offset: [number, number] = [0, 0];
  if (graphic.renderer === "symbol" && graphic.kind === "point") {
    const symbol = renderSymbol(graphic, state.options);
    const size = symbol.getSize();
    const symbolAnchor = symbol.getAnchor();
    element.style.width = `${size.width}px`;
    element.style.height = `${size.height}px`;
    element.innerHTML = symbol.asSVG();
    anchor = "top-left";
    offset = [-symbolAnchor.x, -symbolAnchor.y];
  } else {
    const text = graphic.modifiers.uniqueDesignation || graphic.name;
    element.innerHTML =
      graphic.kind === "text"
        ? `<div class="map-text">${escapeHtml(text)}</div>`
        : `<div class="map-pin" style="background:${graphic.color}"></div>${
            text ? `<div class="map-pin-label">${escapeHtml(text)}</div>` : ""
          }`;
  }
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    dispatch({ type: "select", id: graphic.id });
  });
  markers.get(graphic.id)?.remove();
  const marker = new maplibregl.Marker({ element, anchor, offset, draggable: !locked })
    .setLngLat(graphic.coordinates[0])
    .addTo(map);
  marker.on("dragend", () => {
    const lngLat = marker.getLngLat();
    dispatch({ type: "move", id: graphic.id, coordinates: [[lngLat.lng, lngLat.lat]] });
  });
  markers.set(graphic.id, marker);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] || ch);
}

function graticule(map: Map): FeatureCollection {
  const b = map.getBounds();
  const span = Math.max(b.getEast() - b.getWest(), b.getNorth() - b.getSouth());
  const step = span > 80 ? 30 : span > 30 ? 10 : span > 10 ? 5 : span > 4 ? 1 : 0.5;
  const west = Math.floor(b.getWest() / step) * step;
  const east = Math.ceil(b.getEast() / step) * step;
  const south = Math.max(-80, Math.floor(b.getSouth() / step) * step);
  const north = Math.min(84, Math.ceil(b.getNorth() / step) * step);
  const features: FeatureCollection["features"] = [];
  for (let lng = west; lng <= east; lng += step) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[lng, south], [lng, north]] },
    });
  }
  for (let lat = south; lat <= north; lat += step) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[west, lat], [east, lat]] },
    });
  }
  return { type: "FeatureCollection", features };
}
