"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { beanBack, beanModifier, beanPolygon, circlePolygon, rectPolygon } from "@/lib/geo";
import { useMapStore } from "@/lib/store";
import { affiliationColor, bearingFromNorth, canScaleGraphic, centroid, coalescedNumber, defaultModifiers, dropNullProperties, frameColor, graphicRotation, graphicScale, placingIsMulti, renderControlMeasure, renderSymbol, rotationHandlePosition, shownCoordinates, symbolContract, toBasePoint, type MapFrame } from "@/lib/symbols";
import type { Graphic } from "@/lib/types";
import { syncMcooHatch, type McooHatchView } from "@/lib/mcoo/layer";

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
  if (graphic.kind === "bean" && graphic.coordinates.length >= 2) {
    const [center, edge] = shownCoordinates(graphic);
    return beanPolygon(center, edge);
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
  return graphic.kind === "line" || graphic.kind === "bean" || isArea(graphic);
}

function labelPoint(coords: [number, number][]): [number, number] {
  if (!coords.length) return [0, 0];
  const lng = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
  const lat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
  return [lng, lat];
}

function strokeOf(graphic: Graphic) {
  if (graphic.kind === "bean") return frameColor(graphic.affiliation);
  return graphic.renderer === "generic" ? graphic.color : frameColor(graphic.affiliation);
}

function draftStroke(state: { placing: ReturnType<typeof useMapStore>["state"]["placing"]; galleryAffiliation: string }) {
  if (state.placing?.mode === "generic" && state.placing.kind === "bean") return frameColor(state.galleryAffiliation);
  return "#e65100";
}

const GRAPHIC_LINE_COLOR: ExpressionSpecification = ["case", ["==", ["get", "selected"], 1], "#e65100", ["get", "color"]];
const GRAPHIC_LINE_WIDTH: ExpressionSpecification = ["case", ["==", ["get", "selected"], 1], 3.5, coalescedNumber("lineWidth", 2)];

export function MapCanvas({ mapRef, mcoo }: { mapRef: MutableRefObject<Map | null>; mcoo: McooHatchView }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const markers = useRef(new globalThis.Map<string, maplibregl.Marker>());
  const anchors = useRef(new globalThis.Map<string, maplibregl.Marker>());
  const { state, dispatch } = useMapStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  const mcooRef = useRef(mcoo);
  mcooRef.current = mcoo;
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
      syncMcooHatch(map, mcooRef.current);
      map.resize();
    });
    map.on("style.load", () => {
      tint(map);
      ensureLayers(map);
      syncMcooHatch(map, mcooRef.current);
      draw(map, stateRef.current, markers.current, anchors.current, stateRef, dispatch);
    });
    let suppressClick = false;
    map.on("click", (event) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const current = stateRef.current;
      const id = featureId(map, event.point);
      if (id && !current.placing && !current.options.measure) {
        dispatch({ type: "select", id });
        return;
      }
      if (event.originalEvent.detail > 1 && current.placing?.mode === "symbol") {
        const contract = symbolContract(current.placing.symbol.basicId, current.options.standard);
        if (contract.mode !== "point") return;
      }
      dispatch({ type: "map-click", lng: event.lngLat.lng, lat: event.lngLat.lat });
    });
    map.on("contextmenu", (event) => {
      event.preventDefault();
      const current = stateRef.current;
      if (current.placing || current.options.measure) return;
      dispatch({
        type: "menu",
        menu: {
          x: event.originalEvent.clientX,
          y: event.originalEvent.clientY,
          lng: event.lngLat.lng,
          lat: event.lngLat.lat,
          id: featureId(map, event.point),
        },
      });
    });
    map.on("mousedown", (event) => {
      if (event.originalEvent.button !== 0) return;
      const current = stateRef.current;
      if (current.placing || current.options.measure) return;
      const target = event.originalEvent.target as HTMLElement | null;
      if (target?.closest(".anchor-handle, .move-handle, .scale-handle, .rotate-handle, .maplibregl-marker")) return;
      const id = featureId(map, event.point);
      if (!id) return;
      const graphic = current.graphics.find((item) => item.id === id);
      const layer = graphic ? current.layers.find((item) => item.id === graphic.layerId) : undefined;
      if (!graphic || layer?.locked || layer?.visible === false) return;
      if (graphic.kind === "point" || graphic.kind === "pin" || graphic.kind === "text") return;
      const origin = event.point;
      const startLng = event.lngLat.lng;
      const startLat = event.lngLat.lat;
      const from = graphic.coordinates.map((point) => [point[0], point[1]] as [number, number]);
      let moved = false;
      map.dragPan.disable();
      const onMove = (ev: maplibregl.MapMouseEvent) => {
        if (Math.hypot(ev.point.x - origin.x, ev.point.y - origin.y) < 4) return;
        moved = true;
        const dx = ev.lngLat.lng - startLng;
        const dy = ev.lngLat.lat - startLat;
        dispatch({
          type: "move",
          id: graphic.id,
          history: false,
          coordinates: from.map(([lng, lat]) => [lng + dx, lat + dy]),
        });
      };
      const onUp = (ev: maplibregl.MapMouseEvent) => {
        map.off("mousemove", onMove);
        map.off("mouseup", onUp);
        map.dragPan.enable();
        if (!moved) return;
        suppressClick = true;
        const dx = ev.lngLat.lng - startLng;
        const dy = ev.lngLat.lat - startLat;
        dispatch({
          type: "commit-move",
          id: graphic.id,
          from,
          to: from.map(([lng, lat]) => [lng + dx, lat + dy]),
        });
      };
      map.on("mousemove", onMove);
      map.on("mouseup", onUp);
    });
    map.on("dblclick", (event) => {
      const current = stateRef.current;
      const placing = current.placing;
      if (!placing) return;
      if (placing.mode === "symbol") {
        if (symbolContract(placing.symbol.basicId, current.options.standard).mode === "point") return;
      } else if (placing.kind === "pin" || placing.kind === "text") return;
      event.preventDefault();
      dispatch({ type: "finish-draft" });
    });
    let pointerFrame = 0;
    let pendingPointer: [number, number] | null = null;
    map.on("mousemove", (event) => {
      const current = stateRef.current;
      if (!current.options.cursorCoordinate && !current.placing && !current.options.measure) return;
      pendingPointer = [event.lngLat.lng, event.lngLat.lat];
      if (pointerFrame) return;
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = 0;
        if (pendingPointer) dispatch({ type: "cursor", lngLat: pendingPointer });
      });
    });
    map.on("mouseout", () => dispatch({ type: "cursor", lngLat: null }));
    map.on("moveend", () => {
      if (!map.getSource("grid")) return;
      const current = stateRef.current;
      setData(map, "grid", current.options.grid ? graticule(map) : { type: "FeatureCollection", features: [] });
      if (map.getSource("measures")) {
        const vectors = placementVectors(map, current);
        setData(map, "measures", { type: "FeatureCollection", features: vectors.measures });
        setData(map, "draft", lineCollection(vectors.draft, draftStroke(current)));
      }
    });

    const host = hostRef.current;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      markers.current.forEach((marker) => marker.remove());
      markers.current.clear();
      anchors.current.forEach((marker) => marker.remove());
      anchors.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // The map instance lives for the lifetime of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    syncMcooHatch(map, mcoo);
  }, [mapRef, mcoo]);

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
    if (placingIsMulti(state.placing, state.options.standard)) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [mapRef, state.options.standard, state.placing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    draw(map, state, markers.current, anchors.current, stateRef, dispatch);
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
    if (!map?.isStyleLoaded() || !map.getSource("draft")) return;
    if (!state.placing) return;
    const vectors = placementVectors(map, state);
    setData(map, "measures", { type: "FeatureCollection", features: vectors.measures });
    if (map.getLayer("draft-line")) map.setPaintProperty("draft-line", "line-color", draftStroke(state));
    setData(map, "draft", lineCollection(vectors.draft, draftStroke(state)));
  }, [
    mapRef,
    state.activeLayerId,
    state.cursor,
    state.draft,
    state.galleryAffiliation,
    state.galleryEchelon,
    state.galleryFeint,
    state.galleryHeadquarters,
    state.galleryReinforced,
    state.galleryStatus,
    state.galleryTaskForce,
    state.options,
    state.placing,
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
      if (layer.type === "fill-extrusion") {
        const height = map.getPaintProperty(layer.id, "fill-extrusion-height");
        const base = map.getPaintProperty(layer.id, "fill-extrusion-base");
        if (JSON.stringify(height) === JSON.stringify(["get", "render_height"])) {
          map.setPaintProperty(layer.id, "fill-extrusion-height", coalescedNumber("render_height", 0));
        }
        if (JSON.stringify(base) === JSON.stringify(["get", "render_min_height"])) {
          map.setPaintProperty(layer.id, "fill-extrusion-base", coalescedNumber("render_min_height", 0));
        }
      }
    } catch {
      /* some layers reject a color override */
    }
  }
}

function ensureLayers(map: Map) {
  const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
  for (const id of ["grid", "measure", "draft", "graphics", "measures"]) {
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
        "line-color": GRAPHIC_LINE_COLOR,
        "line-width": GRAPHIC_LINE_WIDTH,
      },
    });
  }
  if (map.getLayer("graphics-line")) {
    map.setPaintProperty("graphics-line", "line-color", GRAPHIC_LINE_COLOR);
    map.setPaintProperty("graphics-line", "line-width", GRAPHIC_LINE_WIDTH);
  }
  if (!map.getLayer("graphics-dashed")) {
    map.addLayer({
      id: "graphics-dashed",
      type: "line",
      source: "graphics",
      filter: ["all", ["!=", ["geometry-type"], "Point"], ["==", ["get", "dashed"], 1]],
      paint: {
        "line-color": GRAPHIC_LINE_COLOR,
        "line-width": GRAPHIC_LINE_WIDTH,
        "line-dasharray": [2, 1.4],
      },
    });
  }
  if (map.getLayer("graphics-dashed")) {
    map.setPaintProperty("graphics-dashed", "line-color", GRAPHIC_LINE_COLOR);
    map.setPaintProperty("graphics-dashed", "line-width", GRAPHIC_LINE_WIDTH);
  }
  if (!map.getLayer("graphics-label")) {
    map.addLayer({
      id: "graphics-label",
      type: "symbol",
      source: "graphics",
      filter: ["==", ["geometry-type"], "Point"],
      layout: {
        "text-field": ["get", "label"],
        "text-size": ["coalesce", ["get", "textSize"], 12],
        "text-font": ["Noto Sans Regular"],
        "text-offset": [
          "case",
          ["==", ["get", "textAnchor"], "center"],
          ["literal", [0, 0]],
          ["literal", [0, 0.6]],
        ],
        "text-anchor": ["coalesce", ["get", "textAnchor"], "top"],
      },
      paint: {
        "text-color": ["coalesce", ["get", "textColor"], "#111"],
        "text-halo-color": "#fff",
        "text-halo-width": 1.2,
      },
    });
  }
  if (map.getLayer("graphics-label")) {
    map.setLayoutProperty("graphics-label", "text-size", ["coalesce", ["get", "textSize"], 12]);
    map.setLayoutProperty("graphics-label", "text-anchor", ["coalesce", ["get", "textAnchor"], "top"]);
    map.setLayoutProperty("graphics-label", "text-offset", [
      "case",
      ["==", ["get", "textAnchor"], "center"],
      ["literal", [0, 0]],
      ["literal", [0, 0.6]],
    ]);
    map.setPaintProperty("graphics-label", "text-color", ["coalesce", ["get", "textColor"], "#111"]);
  }
  if (!map.getLayer("measures-fill")) {
    map.addLayer({
      id: "measures-fill",
      type: "fill",
      source: "measures",
      filter: ["all", ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]], ["has", "fillColor"]],
      paint: {
        "fill-color": ["coalesce", ["get", "fillColor"], "#000000"],
        "fill-opacity": ["coalesce", ["get", "fillOpacity"], 0.25],
      },
    });
  }
  if (!map.getLayer("measures-outline")) {
    map.addLayer({
      id: "measures-outline",
      type: "line",
      source: "measures",
      filter: ["all", ["!=", ["geometry-type"], "Point"], ["!=", ["get", "dashed"], 1]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#000000",
        "line-width": ["+", ["coalesce", ["get", "strokeWidth"], 2], 3.5],
        "line-opacity": ["coalesce", ["get", "lineOpacity"], 1],
      },
    });
  }
  if (!map.getLayer("measures-outline-dashed")) {
    map.addLayer({
      id: "measures-outline-dashed",
      type: "line",
      source: "measures",
      filter: ["all", ["!=", ["geometry-type"], "Point"], ["==", ["get", "dashed"], 1]],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": "#000000",
        "line-width": ["+", ["coalesce", ["get", "strokeWidth"], 2], 3.5],
        "line-opacity": ["coalesce", ["get", "lineOpacity"], 1],
        "line-dasharray": [2, 1.4],
      },
    });
  }
  if (!map.getLayer("measures-select")) {
    map.addLayer({
      id: "measures-select",
      type: "line",
      source: "measures",
      filter: ["all", ["!=", ["geometry-type"], "Point"], ["==", ["get", "selected"], 1]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#e65100",
        "line-width": ["+", ["coalesce", ["get", "strokeWidth"], 2], 6],
        "line-opacity": 0.85,
      },
    });
  }
  if (!map.getLayer("measures-line")) {
    map.addLayer({
      id: "measures-line",
      type: "line",
      source: "measures",
      filter: ["all", ["!=", ["geometry-type"], "Point"], ["!=", ["get", "dashed"], 1]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["coalesce", ["get", "strokeColor"], "#111111"],
        "line-width": ["coalesce", ["get", "strokeWidth"], 2],
        "line-opacity": ["coalesce", ["get", "lineOpacity"], 1],
      },
    });
  }
  if (!map.getLayer("measures-dashed")) {
    map.addLayer({
      id: "measures-dashed",
      type: "line",
      source: "measures",
      filter: ["all", ["!=", ["geometry-type"], "Point"], ["==", ["get", "dashed"], 1]],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": ["coalesce", ["get", "strokeColor"], "#111111"],
        "line-width": ["coalesce", ["get", "strokeWidth"], 2],
        "line-opacity": ["coalesce", ["get", "lineOpacity"], 1],
        "line-dasharray": [2, 1.4],
      },
    });
  }
  map.setPaintProperty("measures-line", "line-color", ["coalesce", ["get", "strokeColor"], "#80E0FF"]);
  map.setPaintProperty("measures-line", "line-width", ["+", ["coalesce", ["get", "strokeWidth"], 2], 1]);
  map.setPaintProperty("measures-dashed", "line-color", ["coalesce", ["get", "strokeColor"], "#80E0FF"]);
  map.setPaintProperty("measures-dashed", "line-width", ["+", ["coalesce", ["get", "strokeWidth"], 2], 1]);
  if (map.getLayer("measures-line") && map.getLayer("measures-outline")) map.moveLayer("measures-outline", "measures-line");
  if (map.getLayer("measures-dashed") && map.getLayer("measures-outline-dashed")) map.moveLayer("measures-outline-dashed", "measures-dashed");
  if (map.getLayer("measures-outline") && map.getLayer("measures-select")) map.moveLayer("measures-select", "measures-outline");
  if (!map.getLayer("measures-label")) {
    map.addLayer({
      id: "measures-label",
      type: "symbol",
      source: "measures",
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "label"], [">", ["length", ["get", "label"]], 0]],
      layout: {
        "text-field": ["get", "label"],
        "text-size": coalescedNumber("textSize", 13),
        "text-font": ["Noto Sans Bold"],
        "text-anchor": "center",
        "text-rotate": coalescedNumber("textRotate", 0),
        "text-rotation-alignment": "viewport",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": ["coalesce", ["get", "fontColor"], "#000000"],
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.25,
      },
    });
  }
  map.setLayoutProperty("measures-label", "text-font", ["Noto Sans Bold"]);
  map.setLayoutProperty("measures-label", "text-size", coalescedNumber("textSize", 13));
  map.setPaintProperty("measures-label", "text-color", ["coalesce", ["get", "fontColor"], "#000000"]);
  map.setPaintProperty("measures-label", "text-halo-color", "#ffffff");
  map.setPaintProperty("measures-label", "text-halo-width", 1.25);
  map.setLayoutProperty("measures-label", "text-rotate", coalescedNumber("textRotate", 0));
  map.setLayoutProperty("measures-label", "text-rotation-alignment", "viewport");
  map.setLayoutProperty("measures-label", "text-allow-overlap", true);
  map.setLayoutProperty("measures-label", "text-ignore-placement", true);
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
  source?.setData({
    type: "FeatureCollection",
    features: data.features.map((feature) => ({
      ...feature,
      properties: dropNullProperties(feature.properties),
    })),
  });
}

function draw(
  map: Map,
  state: ReturnType<typeof useMapStore>["state"],
  markers: globalThis.Map<string, maplibregl.Marker>,
  anchors: globalThis.Map<string, maplibregl.Marker>,
  stateRef: MutableRefObject<ReturnType<typeof useMapStore>["state"]>,
  dispatch: ReturnType<typeof useMapStore>["dispatch"],
) {
  if (!map.isStyleLoaded()) return;
  ensureLayers(map);
  if (!map.getSource("graphics")) return;
  const features: FeatureCollection["features"] = [];
  const live = new Set<string>();

  for (const graphic of state.graphics) {
    if (!layerVisible(graphic, state.layers) || graphic.coordinates.length === 0) continue;
    const selected = state.selectedId === graphic.id ? 1 : 0;
    const color = strokeOf(graphic);
    const dashed = graphic.status === "A" ? 1 : 0;
    const bean = graphic.kind === "bean";
    const label = bean ? "" : [graphic.modifiers.uniqueDesignation, graphic.name].filter(Boolean).join(" · ");

    if (graphic.kind === "point" || graphic.kind === "pin" || graphic.kind === "text") {
      live.add(graphic.id);
      upsertMarker(map, markers, graphic, state, selected === 1, dispatch);
      continue;
    }

    if (graphic.renderer === "symbol" && (graphic.kind === "line" || graphic.kind === "area")) continue;

    if (isLine(graphic) && outlineOf(graphic).length >= 2) {
      const ring = outlineOf(graphic);
      if (bean) {
        const shown = shownCoordinates(graphic);
        const width = state.options.strokeWidth || 2;
        features.push({
          type: "Feature",
          properties: { id: graphic.id, color: "#000000", selected: 0, dashed, label: "", lineWidth: width + 3.5 },
          geometry: { type: "LineString", coordinates: ring },
        });
        features.push({
          type: "Feature",
          properties: { id: graphic.id, color, selected: 0, dashed, label: "", lineWidth: width + 1 },
          geometry: { type: "LineString", coordinates: ring },
        });
        const mark = beanModifier(graphic.echelon);
        if (mark && shown.length >= 2) {
          features.push({
            type: "Feature",
            properties: { id: graphic.id, color, selected: 0, dashed: 0, label: mark, textColor: color, textSize: 16, textAnchor: "center" },
            geometry: { type: "Point", coordinates: beanBack(shown[0], shown[1]) },
          });
        }
        const caption = [graphic.modifiers.uniqueDesignation, graphic.modifiers.higherFormation, graphic.modifiers.additionalInformation]
          .filter(Boolean)
          .join(" · ");
        if (caption && shown.length >= 2) {
          features.push({
            type: "Feature",
            properties: { id: graphic.id, color, selected: 0, dashed: 0, label: caption, textColor: color, textSize: 13, textAnchor: "center" },
            geometry: { type: "Point", coordinates: shown[0] },
          });
        }
      } else if (isArea(graphic) && ring.length >= 4) {
        features.push({
          type: "Feature",
          properties: { id: graphic.id, color, selected, dashed, label: "" },
          geometry: { type: "Polygon", coordinates: [ring] },
        });
        features.push({
          type: "Feature",
          properties: { id: graphic.id, color, selected, dashed, label },
          geometry: { type: "Point", coordinates: labelPoint(ring) },
        });
      } else {
        features.push({
          type: "Feature",
          properties: { id: graphic.id, color, selected, dashed, label: "" },
          geometry: { type: "LineString", coordinates: ring },
        });
        features.push({
          type: "Feature",
          properties: { id: graphic.id, color, selected, dashed, label },
          geometry: { type: "Point", coordinates: labelPoint(ring) },
        });
      }
    }
  }

  for (const [id, marker] of markers) {
    if (!live.has(id)) {
      marker.remove();
      markers.delete(id);
    }
  }

  setData(map, "graphics", { type: "FeatureCollection", features });
  const vectors = placementVectors(map, state);
  setData(map, "measures", { type: "FeatureCollection", features: vectors.measures });
  if (map.getLayer("draft-line")) map.setPaintProperty("draft-line", "line-color", draftStroke(state));
  setData(map, "draft", lineCollection(vectors.draft, draftStroke(state)));
  setData(map, "measure", lineCollection(state.measurePts, "#111"));
  syncAnchors(map, state, anchors, stateRef, dispatch);
  setData(map, "grid", state.options.grid ? graticule(map) : { type: "FeatureCollection", features: [] });
}

function mapFrame(map: Map): MapFrame {
  const bounds = map.getBounds();
  const canvas = map.getCanvas();
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
    width: canvas.clientWidth || canvas.width,
    height: canvas.clientHeight || canvas.height,
  };
}

function measureFeatures(map: Map, state: ReturnType<typeof useMapStore>["state"]): FeatureCollection["features"] {
  const frame = mapFrame(map);
  const features: FeatureCollection["features"] = [];
  for (const graphic of state.graphics) {
    if (!layerVisible(graphic, state.layers)) continue;
    if (graphic.renderer !== "symbol" || (graphic.kind !== "line" && graphic.kind !== "area")) continue;
    if (graphic.coordinates.length < 1) continue;
    const selected = state.selectedId === graphic.id;
    const rendered = renderControlMeasure(graphic, state.options, frame, selected);
    if (rendered?.length) {
      features.push(...rendered);
      continue;
    }
    if (graphic.coordinates.length < 2) continue;
    const ring = outlineOf(graphic);
    if (ring.length < 2) continue;
    const label = [graphic.modifiers.uniqueDesignation, graphic.name].filter(Boolean).join(" · ");
    features.push({
      type: "Feature",
      properties: { id: graphic.id, mil: 1, selected: selected ? 1 : 0, strokeColor: strokeOf(graphic), strokeWidth: 2, lineOpacity: 1, label: "" },
      geometry: { type: "LineString", coordinates: ring },
    });
    features.push({
      type: "Feature",
      properties: { id: graphic.id, mil: 1, label },
      geometry: { type: "Point", coordinates: labelPoint(ring) },
    });
  }
  return features;
}

function rubberPoints(state: ReturnType<typeof useMapStore>["state"]): [number, number][] {
  if (!placingIsMulti(state.placing, state.options.standard)) return [];
  const points = [...state.draft];
  const cursor = state.cursor;
  if (!cursor) return points;
  const last = points[points.length - 1];
  if (last && last[0] === cursor[0] && last[1] === cursor[1]) return points;
  const next = [...points, cursor];
  if (state.placing?.mode === "generic" && state.placing.kind === "bean" && next.length >= 2) {
    return beanPolygon(next[0], next[next.length - 1]);
  }
  return next;
}

function previewGraphic(state: ReturnType<typeof useMapStore>["state"]): Graphic | null {
  const placing = state.placing;
  if (!placing || placing.mode !== "symbol") return null;
  const contract = symbolContract(placing.symbol.basicId, state.options.standard);
  if (contract.mode === "point") return null;
  const points = rubberPoints(state);
  if (points.length < contract.minPoints) return null;
  const coordinates = contract.maxPoints != null && points.length > contract.maxPoints ? points.slice(0, contract.maxPoints) : points;
  const symbol = placing.symbol;
  return {
    id: "draft",
    layerId: state.activeLayerId,
    name: symbol.name,
    renderer: "symbol",
    kind: symbol.kind,
    basicId: symbol.basicId,
    affiliation: state.galleryAffiliation,
    status: state.galleryStatus,
    echelon: state.galleryEchelon,
    headquarters: state.galleryHeadquarters,
    taskForce: state.galleryTaskForce,
    feint: state.galleryFeint,
    color: affiliationColor(state.galleryAffiliation),
    coordinates,
    modifiers: defaultModifiers(symbol.basicId, state.options.standard, state.galleryReinforced),
  };
}

function placementVectors(map: Map, state: ReturnType<typeof useMapStore>["state"]) {
  const measures = measureFeatures(map, state);
  const graphic = previewGraphic(state);
  const rendered = graphic ? renderControlMeasure(graphic, state.options, mapFrame(map), false) : null;
  if (rendered?.length) return { measures: [...measures, ...rendered], draft: [] as [number, number][] };
  return { measures, draft: rubberPoints(state) };
}

function featureId(map: Map, point: maplibregl.PointLike) {
  const layers = [
    "graphics-fill",
    "graphics-line",
    "graphics-dashed",
    "measures-fill",
    "measures-select",
    "measures-outline",
    "measures-outline-dashed",
    "measures-line",
    "measures-dashed",
    "measures-label",
  ].filter((id) => map.getLayer(id));
  if (!layers.length) return null;
  const hits = map.queryRenderedFeatures(point, { layers });
  for (const hit of hits) {
    const id = hit.properties?.id;
    if (typeof id === "string" && id !== "draft") return id;
  }
  return null;
}

function placeHandle(
  map: Map,
  anchors: globalThis.Map<string, maplibregl.Marker>,
  wanted: Set<string>,
  stateRef: MutableRefObject<ReturnType<typeof useMapStore>["state"]>,
  dispatch: ReturnType<typeof useMapStore>["dispatch"],
  graphic: Graphic,
  kind: "move" | "scale" | "rotate",
  position: [number, number],
) {
  const key = `${graphic.id}:${kind}`;
  wanted.add(key);
  let marker = anchors.get(key);
  if (!marker) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = kind === "move" ? "move-handle" : kind === "scale" ? "scale-handle" : "rotate-handle";
    element.title = kind === "move" ? "Move" : kind === "scale" ? "Scale" : "Rotate";
    element.setAttribute("aria-label", kind === "move" ? "Move symbol" : kind === "scale" ? "Scale symbol" : "Rotate symbol");
    element.addEventListener("click", (event) => event.stopPropagation());
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const host = map.getContainer().getBoundingClientRect();
      const lngLat = map.unproject([event.clientX - host.left, event.clientY - host.top]);
      dispatch({
        type: "menu",
        menu: { x: event.clientX, y: event.clientY, lng: lngLat.lng, lat: lngLat.lat, id: graphic.id },
      });
    });
    let origin: [number, number][] = [];
    let startLng = 0;
    let startLat = 0;
    let startScale = 1;
    let startRotation = 0;
    marker = new maplibregl.Marker({
      element,
      draggable: true,
      anchor: "center",
      offset: kind === "scale" ? [12, -12] : kind === "rotate" ? [0, -10] : [0, 0],
    })
      .setLngLat(position)
      .addTo(map);
    marker.on("dragstart", () => {
      element.dataset.dragging = "1";
      const current = stateRef.current.graphics.find((item) => item.id === graphic.id);
      origin = current ? current.coordinates.map((point) => [point[0], point[1]] as [number, number]) : [];
      startScale = current ? graphicScale(current) : 1;
      startRotation = current ? graphicRotation(current) : 0;
      const lngLat = marker?.getLngLat();
      startLng = lngLat?.lng ?? position[0];
      startLat = lngLat?.lat ?? position[1];
    });
    marker.on("drag", () => {
      const lngLat = marker?.getLngLat();
      if (!lngLat || !origin.length) return;
      if (kind === "move") {
        dispatch({
          type: "move",
          id: graphic.id,
          history: false,
          coordinates: origin.map(([lng, lat]) => [lng + lngLat.lng - startLng, lat + lngLat.lat - startLat]),
        });
        return;
      }
      const [originX, originY] = graphic.kind === "bean" ? origin[0] : centroid(origin);
      if (kind === "rotate") {
        const startBearing = bearingFromNorth([originX, originY], [startLng, startLat]);
        const bearing = bearingFromNorth([originX, originY], [lngLat.lng, lngLat.lat]);
        dispatch({ type: "rotate", id: graphic.id, history: false, rotation: startRotation + bearing - startBearing });
        return;
      }
      const basis = Math.hypot(startLng - originX, startLat - originY) / startScale || 1e-9;
      dispatch({
        type: "scale",
        id: graphic.id,
        history: false,
        scale: Math.hypot(lngLat.lng - originX, lngLat.lat - originY) / basis,
      });
    });
    marker.on("dragend", () => {
      delete element.dataset.dragging;
      const lngLat = marker?.getLngLat();
      if (!lngLat || !origin.length) return;
      if (kind === "move") {
        dispatch({
          type: "commit-move",
          id: graphic.id,
          from: origin,
          to: origin.map(([lng, lat]) => [lng + lngLat.lng - startLng, lat + lngLat.lat - startLat]),
        });
        return;
      }
      const [originX, originY] = graphic.kind === "bean" ? origin[0] : centroid(origin);
      if (kind === "rotate") {
        const startBearing = bearingFromNorth([originX, originY], [startLng, startLat]);
        const bearing = bearingFromNorth([originX, originY], [lngLat.lng, lngLat.lat]);
        dispatch({
          type: "rotate",
          id: graphic.id,
          rotation: startRotation + bearing - startBearing,
          from: startRotation,
        });
        return;
      }
      const basis = Math.hypot(startLng - originX, startLat - originY) / startScale || 1e-9;
      dispatch({
        type: "scale",
        id: graphic.id,
        scale: Math.hypot(lngLat.lng - originX, lngLat.lat - originY) / basis,
        from: startScale,
      });
    });
    anchors.set(key, marker);
  } else if (!marker.getElement().dataset.dragging) {
    marker.setLngLat(position);
  }
}

function syncAnchors(
  map: Map,
  state: ReturnType<typeof useMapStore>["state"],
  anchors: globalThis.Map<string, maplibregl.Marker>,
  stateRef: MutableRefObject<ReturnType<typeof useMapStore>["state"]>,
  dispatch: ReturnType<typeof useMapStore>["dispatch"],
) {
  const graphic = state.graphics.find((item) => item.id === state.selectedId);
  const layer = graphic ? state.layers.find((item) => item.id === graphic.layerId) : undefined;
  const bean = graphic?.kind === "bean";
  const editable = Boolean(
    graphic &&
      !layer?.locked &&
      layer?.visible !== false &&
      graphic.coordinates.length > 0 &&
      (bean || (graphic.renderer === "symbol" && (graphic.kind === "line" || graphic.kind === "area"))),
  );
  const wanted = new Set<string>();
  if (editable && graphic && bean) {
    const shown = shownCoordinates(graphic);
    const ring = shown.length >= 2 ? beanPolygon(shown[0], shown[1]) : [];
    let east = -Infinity;
    let north = -Infinity;
    for (const [lng, lat] of ring) {
      if (lng > east) east = lng;
      if (lat > north) north = lat;
    }
    placeHandle(map, anchors, wanted, stateRef, dispatch, graphic, "move", shown[0] ?? centroid(shown));
    if (Number.isFinite(east) && Number.isFinite(north)) {
      placeHandle(map, anchors, wanted, stateRef, dispatch, graphic, "scale", [east, north]);
    }
    placeHandle(map, anchors, wanted, stateRef, dispatch, graphic, "rotate", rotationHandlePosition(graphic));
  } else if (editable && graphic) {
    const shown = shownCoordinates(graphic);
    shown.forEach((coord, index) => {
      const key = `${graphic.id}:${index}`;
      wanted.add(key);
      let marker = anchors.get(key);
      if (!marker) {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "anchor-handle";
        element.title = `Point ${index + 1}`;
        element.setAttribute("aria-label", `Point ${index + 1}`);
        element.addEventListener("click", (event) => event.stopPropagation());
        element.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const host = map.getContainer().getBoundingClientRect();
          const lngLat = map.unproject([event.clientX - host.left, event.clientY - host.top]);
          dispatch({
            type: "menu",
            menu: { x: event.clientX, y: event.clientY, lng: lngLat.lng, lat: lngLat.lat, id: graphic.id },
          });
        });
        marker = new maplibregl.Marker({ element, draggable: true, anchor: "center" }).setLngLat(coord).addTo(map);
        marker.getElement().setAttribute("aria-label", `Point ${index + 1}`);
        marker.on("dragstart", () => {
          element.dataset.dragging = "1";
        });
        marker.on("dragend", () => {
          delete element.dataset.dragging;
          const lngLat = marker?.getLngLat();
          if (!lngLat) return;
          const current = stateRef.current.graphics.find((item) => item.id === graphic.id);
          if (!current) return;
          const scale = canScaleGraphic(current) ? graphicScale(current) : 1;
          const rotation = canScaleGraphic(current) ? graphicRotation(current) : 0;
          const base = toBasePoint(current.coordinates, scale, rotation, [lngLat.lng, lngLat.lat]);
          const coordinates = current.coordinates.map((point, pointIndex) => (pointIndex === index ? base : point));
          dispatch({ type: "move", id: graphic.id, coordinates });
        });
        anchors.set(key, marker);
      } else if (!marker.getElement().dataset.dragging) {
        marker.setLngLat(coord);
        marker.getElement().setAttribute("aria-label", `Point ${index + 1}`);
      }
    });
    placeHandle(map, anchors, wanted, stateRef, dispatch, graphic, "move", centroid(shown));
    if (canScaleGraphic(graphic)) {
      let east = -Infinity;
      let north = -Infinity;
      for (const [lng, lat] of shown) {
        if (lng > east) east = lng;
        if (lat > north) north = lat;
      }
      placeHandle(map, anchors, wanted, stateRef, dispatch, graphic, "scale", [east, north]);
      placeHandle(map, anchors, wanted, stateRef, dispatch, graphic, "rotate", rotationHandlePosition(graphic));
    }
  }
  for (const [key, marker] of anchors) {
    if (!wanted.has(key)) {
      marker.remove();
      anchors.delete(key);
    }
  }
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
  const turn = canScaleGraphic(graphic) ? graphicRotation(graphic) : 0;
  if (turn) {
    element.style.transform = `rotate(${turn}deg)`;
    element.style.transformOrigin = "center center";
  }
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
    if (!symbol) {
      markers.get(graphic.id)?.remove();
      markers.delete(graphic.id);
      return;
    }
    element.style.width = `${symbol.width}px`;
    element.style.height = `${symbol.height}px`;
    element.innerHTML = symbol.svg;
    anchor = "top-left";
    offset = [-symbol.anchorX, -symbol.anchorY];
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
  element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const host = map.getContainer().getBoundingClientRect();
    const lngLat = map.unproject([event.clientX - host.left, event.clientY - host.top]);
    dispatch({
      type: "menu",
      menu: { x: event.clientX, y: event.clientY, lng: lngLat.lng, lat: lngLat.lat, id: graphic.id },
    });
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
