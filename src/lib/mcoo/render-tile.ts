import { PbfReader } from "pbf";
import { VectorTile, type VectorTileLayer } from "@mapbox/vector-tile";
import { COVER, adjustedClass, hatchColor, mobilityClass, obstacleZone, type CoverId, type GroundCondition, type MovementClass } from "./classify";

const SIZE = 256;

const BUILT = new Set([
  "residential",
  "suburb",
  "neighbourhood",
  "quarter",
  "industrial",
  "commercial",
  "retail",
  "railway",
  "military",
  "hospital",
  "school",
  "university",
  "college",
  "garages",
  "construction",
  "brownfield",
]);
const CROP = new Set(["farmland", "orchard", "vineyard", "allotments", "greenhouse_horticulture"]);
const GRASS = new Set(["grass", "meadow", "village_green", "recreation_ground"]);
const TREE = new Set(["forest", "wood"]);
const MAJOR_ROAD = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "motorway_link",
  "trunk_link",
  "primary_link",
  "secondary_link",
]);
const MINOR_ROAD = new Set(["tertiary", "tertiary_link", "minor", "unclassified", "track"]);

let planetTemplate: Promise<string | null> | null = null;

function planetTiles(): Promise<string | null> {
  if (!planetTemplate) {
    planetTemplate = fetch("https://tiles.openfreemap.org/planet")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { tiles?: string[] } | null) => json?.tiles?.[0] ?? null)
      .catch(() => null)
      .then((url) => {
        if (!url) planetTemplate = null;
        return url;
      });
  }
  return planetTemplate;
}

function tileLat(z: number, y: number): number {
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function metersPerPixel(lat: number, z: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

function textProp(props: Record<string, number | string | boolean>, key: string): string {
  const value = props[key];
  return typeof value === "string" ? value : "";
}

function landcoverId(cls: string): CoverId {
  if (cls === "wood") return COVER.tree;
  if (cls === "grass") return COVER.grass;
  if (cls === "farmland") return COVER.crop;
  if (cls === "wetland") return COVER.wetland;
  if (cls === "ice" || cls === "snow") return COVER.ice;
  if (cls === "scrub" || cls === "shrub") return COVER.shrub;
  return COVER.open;
}

function landuseId(cls: string): CoverId {
  if (BUILT.has(cls)) return COVER.built;
  if (CROP.has(cls)) return COVER.crop;
  if (GRASS.has(cls)) return COVER.grass;
  if (TREE.has(cls)) return COVER.tree;
  if (cls === "wetland" || cls === "marsh") return COVER.wetland;
  if (cls === "scrub") return COVER.shrub;
  return COVER.open;
}

async function elevation(z: number, x: number, y: number, signal: AbortSignal): Promise<ImageData | null> {
  const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, { signal });
  if (!res.ok) return null;
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return image;
}

function slopeGrid(image: ImageData | null, z: number, y: number): Uint8Array {
  const slope = new Uint8Array(SIZE * SIZE);
  if (!image) return slope;
  const width = image.width;
  const height = image.height;
  const src = image.data;
  const elev = new Float32Array(width * height);
  for (let i = 0; i < elev.length; i++) {
    const o = i * 4;
    elev[i] = src[o] * 256 + src[o + 1] + src[o + 2] / 256 - 32768;
  }
  const mpp = metersPerPixel(tileLat(z, y), z) * (256 / width);
  const at = (ix: number, iy: number) => elev[Math.max(0, Math.min(height - 1, iy)) * width + Math.max(0, Math.min(width - 1, ix))];
  for (let py = 0; py < SIZE; py++) {
    const sy = Math.min(height - 1, Math.floor(((py + 0.5) * height) / SIZE));
    for (let px = 0; px < SIZE; px++) {
      const sx = Math.min(width - 1, Math.floor(((px + 0.5) * width) / SIZE));
      const z0 = at(sx, sy);
      const zx1 = at(sx + 1, sy);
      const zx0 = at(sx - 1, sy);
      const zy1 = at(sx, sy + 1);
      const zy0 = at(sx, sy - 1);
      if (z0 < -1000 || zx1 < -1000 || zx0 < -1000 || zy1 < -1000 || zy0 < -1000) continue;
      const rise = Math.hypot(zx1 - zx0, zy1 - zy0) / (2 * mpp);
      slope[py * SIZE + px] = Math.min(90, Math.round((Math.atan(rise) * 180) / Math.PI));
    }
  }
  return slope;
}

function drawPolygons(ctx: OffscreenCanvasRenderingContext2D, layer: VectorTileLayer | undefined, accept: (cls: string) => boolean) {
  if (!layer) return;
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type !== 3 || !accept(textProp(feature.properties, "class"))) continue;
    const rings = feature.loadGeometry();
    ctx.beginPath();
    for (const ring of rings) {
      for (let p = 0; p < ring.length; p++) {
        if (p === 0) ctx.moveTo(ring[p].x, ring[p].y);
        else ctx.lineTo(ring[p].x, ring[p].y);
      }
      ctx.closePath();
    }
    ctx.fill("evenodd");
  }
}

function drawLines(
  ctx: OffscreenCanvasRenderingContext2D,
  layer: VectorTileLayer | undefined,
  widthFor: (cls: string, brunnel: string) => number,
) {
  if (!layer) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type !== 2) continue;
    const width = widthFor(textProp(feature.properties, "class"), textProp(feature.properties, "brunnel"));
    if (width <= 0) continue;
    ctx.lineWidth = width;
    const lines = feature.loadGeometry();
    ctx.beginPath();
    for (const line of lines) {
      for (let p = 0; p < line.length; p++) {
        if (p === 0) ctx.moveTo(line[p].x, line[p].y);
        else ctx.lineTo(line[p].x, line[p].y);
      }
    }
    ctx.stroke();
  }
}

function strokeWidth(meters: number, lat: number, z: number, extent: number): number {
  const px = Math.max(1.4, meters / metersPerPixel(lat, z));
  return (px * extent) / SIZE;
}

function coverGrid(tile: VectorTile, lat: number, z: number): Uint8Array {
  const cover = new Uint8Array(SIZE * SIZE);
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return cover;
  const stamp = (id: CoverId, extent: number, draw: () => void) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.setTransform(SIZE / extent, 0, 0, SIZE / extent, 0, 0);
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#000";
    draw();
    const pixels = ctx.getImageData(0, 0, SIZE, SIZE).data;
    for (let i = 0; i < cover.length; i++) if (pixels[i * 4 + 3] > 100) cover[i] = id;
  };
  const extentOf = (layer: VectorTileLayer | undefined) => layer?.extent || 4096;
  const paintPolygons = (id: CoverId, layer: VectorTileLayer | undefined, accept: (cls: string) => boolean) => {
    if (!layer) return;
    stamp(id, extentOf(layer), () => drawPolygons(ctx, layer, accept));
  };

  paintPolygons(COVER.grass, tile.layers.landcover, (cls) => landcoverId(cls) === COVER.grass);
  paintPolygons(COVER.crop, tile.layers.landcover, (cls) => landcoverId(cls) === COVER.crop);
  paintPolygons(COVER.shrub, tile.layers.landcover, (cls) => landcoverId(cls) === COVER.shrub);
  paintPolygons(COVER.tree, tile.layers.landcover, (cls) => landcoverId(cls) === COVER.tree);
  paintPolygons(COVER.ice, tile.layers.landcover, (cls) => landcoverId(cls) === COVER.ice);
  paintPolygons(COVER.wetland, tile.layers.landcover, (cls) => landcoverId(cls) === COVER.wetland);
  paintPolygons(COVER.grass, tile.layers.landuse, (cls) => landuseId(cls) === COVER.grass);
  paintPolygons(COVER.crop, tile.layers.landuse, (cls) => landuseId(cls) === COVER.crop);
  paintPolygons(COVER.tree, tile.layers.landuse, (cls) => landuseId(cls) === COVER.tree);
  paintPolygons(COVER.wetland, tile.layers.landuse, (cls) => landuseId(cls) === COVER.wetland);
  paintPolygons(COVER.built, tile.layers.landuse, (cls) => landuseId(cls) === COVER.built);
  paintPolygons(COVER.built, tile.layers.building, () => true);
  paintPolygons(COVER.water, tile.layers.water, (cls) => cls !== "swimming_pool" && cls !== "fountain");

  const waterway = tile.layers.waterway;
  if (waterway) {
    const extent = extentOf(waterway);
    stamp(COVER.water, extent, () =>
      drawLines(ctx, waterway, (cls, brunnel) => {
        if (brunnel === "tunnel") return 0;
        if (cls === "river") return strokeWidth(70, lat, z, extent);
        if (cls === "canal") return strokeWidth(36, lat, z, extent);
        return 0;
      }),
    );
  }
  const roads = tile.layers.transportation;
  if (roads) {
    const extent = extentOf(roads);
    stamp(COVER.roadMinor, extent, () =>
      drawLines(ctx, roads, (cls, brunnel) => (brunnel !== "tunnel" && MINOR_ROAD.has(cls) ? strokeWidth(14, lat, z, extent) : 0)),
    );
    stamp(COVER.roadMajor, extent, () =>
      drawLines(ctx, roads, (cls, brunnel) => (brunnel !== "tunnel" && MAJOR_ROAD.has(cls) ? strokeWidth(26, lat, z, extent) : 0)),
    );
  }
  return cover;
}

async function vectorTile(z: number, x: number, y: number, signal: AbortSignal): Promise<VectorTile | null> {
  const template = await planetTiles();
  if (!template) return null;
  const url = template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  return new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
}

const CONTOUR: Record<number, [number, number, number, number]> = {
  1: [16, 96, 38, 255],
  3: [0, 0, 0, 255],
  4: [18, 74, 150, 255],
};

/** Open, green hatch, built-up, and water. Restricted and severely restricted share one outline. */
function outlineKind(zone: number): number {
  if (zone <= 0) return 0;
  if (zone <= 2) return 1;
  return zone;
}

const zoneCache = new Map<string, Uint8Array>();

function rememberZones(key: string, zones: Uint8Array) {
  zoneCache.set(key, zones);
  while (zoneCache.size > 80) {
    const oldest = zoneCache.keys().next().value;
    if (oldest === undefined) break;
    zoneCache.delete(oldest);
  }
}

/** 1×1 transparent PNG. Used when a canvas cannot be exported. */
const TRANSPARENT_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="),
  (char) => char.charCodeAt(0),
);

/** Encode a canvas only after it has a 2D context and a non-zero size. */
export async function canvasToPng(canvas: OffscreenCanvas): Promise<ArrayBuffer> {
  if (canvas.width < 1 || canvas.height < 1) return TRANSPARENT_PNG.slice().buffer;
  const ctx = canvas.getContext("2d");
  if (!ctx) return TRANSPARENT_PNG.slice().buffer;
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

let blankPng: Promise<ArrayBuffer> | null = null;

function blankTile(): Promise<ArrayBuffer> {
  blankPng ??= canvasToPng(new OffscreenCanvas(1, 1));
  return blankPng;
}

/** A 256 px overlay tile. Elevation and land cover are read in the browser. */
export async function renderHatchTile(
  z: number,
  x: number,
  y: number,
  movement: MovementClass,
  ground: GroundCondition,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const [dem, vectors] = await Promise.all([
    elevation(z, x, y, signal).catch(() => null),
    vectorTile(z, x, y, signal).catch(() => null),
  ]);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const slope = slopeGrid(dem, z, y);
  const cover = vectors ? coverGrid(vectors, tileLat(z, y), z) : new Uint8Array(SIZE * SIZE);
  const zones = new Uint8Array(SIZE * SIZE);
  const zoneKey = `${z}/${x}/${y}/${movement}/${ground}`;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const kind = cover[i] as CoverId;
    const cls = adjustedClass(kind, mobilityClass(kind, slope[i], movement), movement, ground);
    zones[i] = obstacleZone(kind, cls);
  }
  rememberZones(zoneKey, zones);

  const zoneNear = (px: number, py: number): number | null => {
    let tx = x;
    let ty = y;
    let sx = px;
    let sy = py;
    if (px < 0) {
      tx -= 1;
      sx += SIZE;
    } else if (px >= SIZE) {
      tx += 1;
      sx -= SIZE;
    }
    if (py < 0) {
      ty -= 1;
      sy += SIZE;
    } else if (py >= SIZE) {
      ty += 1;
      sy -= SIZE;
    }
    if (tx === x && ty === y) return zones[sy * SIZE + sx];
    return zoneCache.get(`${z}/${tx}/${ty}/${movement}/${ground}`)?.[sy * SIZE + sx] ?? null;
  };

  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  if (!ctx) return blankTile();
  const image = ctx.createImageData(SIZE, SIZE);
  const pixels = image.data;
  let painted = 0;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const i = py * SIZE + px;
      const kind = cover[i] as CoverId;
      const cls = adjustedClass(kind, mobilityClass(kind, slope[i], movement), movement, ground);
      const color = hatchColor(kind, cls, x * SIZE + px, y * SIZE + py);
      if (!color) continue;
      const o = i * 4;
      pixels[o] = color[0];
      pixels[o + 1] = color[1];
      pixels[o + 2] = color[2];
      pixels[o + 3] = color[3];
      painted++;
    }
  }
  const kindNear = (px: number, py: number): number | null => {
    const zone = zoneNear(px, py);
    return zone === null ? null : outlineKind(zone);
  };
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const kind = outlineKind(zones[py * SIZE + px]);
      if (kind === 0) continue;
      let distance = 99;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          const near = kindNear(px + dx, py + dy);
          if (near === null || near === kind) continue;
          distance = Math.min(distance, Math.max(Math.abs(dx), Math.abs(dy)));
        }
      }
      const color = CONTOUR[kind];
      if (distance > 2 || !color) continue;
      const o = (py * SIZE + px) * 4;
      pixels[o] = color[0];
      pixels[o + 1] = color[1];
      pixels[o + 2] = color[2];
      pixels[o + 3] = color[3];
      painted++;
    }
  }
  if (!painted) return blankTile();
  ctx.putImageData(image, 0, 0);
  return canvasToPng(canvas);
}
