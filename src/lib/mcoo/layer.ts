import type { Map, RasterTileSource } from "maplibre-gl";
import type { GroundCondition, MovementClass } from "./classify";
import { ensureCooProtocol } from "./protocol";

const SOURCE = "mcoo-hatch";
const LAYER = "mcoo-hatch";

export type McooHatchView = {
  movement: MovementClass;
  ground: GroundCondition;
  opacity: number;
} | null;

let lastTiles = "";

function tileUrl(view: Exclude<McooHatchView, null>) {
  return `coo://overlay/v7/{z}/{x}/{y}/${view.movement}/${view.ground}`;
}

function beforeLabels(map: Map): string | undefined {
  const symbol = map.getStyle()?.layers?.find((layer) => layer.type === "symbol");
  if (symbol && map.getLayer(symbol.id)) return symbol.id;
  if (map.getLayer("graphics-fill")) return "graphics-fill";
  return undefined;
}

function addLayer(map: Map) {
  if (map.getLayer(LAYER)) return;
  const layer = {
    id: LAYER,
    type: "raster" as const,
    source: SOURCE,
    paint: { "raster-opacity": 1, "raster-fade-duration": 0, "raster-resampling": "nearest" as const },
  };
  const before = beforeLabels(map);
  if (before) map.addLayer(layer, before);
  else map.addLayer(layer);
}

function paintOpacity(map: Map, opacity: number) {
  if (!map.getLayer(LAYER)) return;
  const value = Math.min(1, Math.max(0.15, opacity));
  map.setPaintProperty(LAYER, "raster-opacity", value);
}

/** Shows or clears the obstacle hatching. The tiles are drawn in the browser. */
export function syncMcooHatch(map: Map, view: McooHatchView) {
  if (!view) {
    lastTiles = "";
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    return;
  }
  ensureCooProtocol();
  const tiles = [tileUrl(view)];
  const key = tiles[0];
  const existing = map.getSource(SOURCE) as RasterTileSource | undefined;
  if (existing) {
    if (lastTiles !== key) {
      existing.setTiles(tiles);
      lastTiles = key;
    }
    addLayer(map);
    paintOpacity(map, view.opacity);
    return;
  }
  map.addSource(SOURCE, { type: "raster", tiles, tileSize: 256, minzoom: 10, maxzoom: 14 });
  lastTiles = key;
  addLayer(map);
  paintOpacity(map, view.opacity);
}
