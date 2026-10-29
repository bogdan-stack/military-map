import {
  DrawRules,
  MilStdAttributes,
  MilStdIconRenderer,
  Modifiers,
  MSLookup,
  SymbolID,
  SymbolUtilities,
  WebRenderer,
} from "@armyc2.c5isr.renderer/mil-sym-ts-web";
import type { Feature, Position } from "geojson";
import { sectionOfBasicId } from "./catalog";
import { EMPTY_MODIFIERS, type Affiliation, type Graphic, type Modifiers as ModifierText, type Placing, type Presence, type ViewOptions } from "./types";

export type DrawnSymbol = {
  svg: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
};

/** One click, a fixed anchor count, or an open line or area. */
export type DrawMode = "point" | "fixed" | "open";

export type SymbolContract = {
  minPoints: number;
  /** Null when the symbol accepts as many anchors as the user draws. */
  maxPoints: number | null;
  modifiers: string[];
  mode: DrawMode;
  /** Required distance in meters. Empty when the graphic does not need one. */
  distance: string;
  /** Required azimuth in degrees. Empty when the graphic does not need one. */
  azimuth: string;
};

const HUGE_POINT_COUNT = 24;
const contractCache = new Map<string, SymbolContract>();

/** Counts the renderer requires before a corridor, ring, ellipse, or sector will draw. */
function amplifierDefaults(drawRule: number) {
  const width = "1000";
  const radii = "1000,500";
  const bearing = "0";
  const sector = "315,45";
  if (drawRule === DrawRules.ELLIPSE1 || drawRule === DrawRules.RECTANGULAR2 || drawRule === DrawRules.POINT17) {
    return { distance: radii, azimuth: bearing };
  }
  if (drawRule === DrawRules.POINT18 || drawRule === DrawRules.ARC1) {
    return { distance: radii, azimuth: sector };
  }
  if (
    drawRule === DrawRules.CIRCULAR1 ||
    drawRule === DrawRules.CIRCULAR2 ||
    drawRule === DrawRules.RECTANGULAR1 ||
    drawRule === DrawRules.RECTANGULAR3 ||
    drawRule === DrawRules.CORRIDOR1
  ) {
    return { distance: width, azimuth: "" };
  }
  return { distance: "", azimuth: "" };
}

/** Anchor count and allowed amplifiers for one symbol, from the MIL-STD lookup. */
export function symbolContract(basicId: string, standard: ViewOptions["standard"]): SymbolContract {
  const id = (basicId || "").padEnd(8, "0").slice(0, 8);
  const key = `${standard}:${id}`;
  const cached = contractCache.get(key);
  if (cached) return cached;
  const version = standard === "APP6" ? SymbolID.Version_APP6D : SymbolID.Version_2525Dch1;
  const lookup = MSLookup.getInstance();
  let info = lookup.getMSLInfo(id, version);
  if (!info && version !== SymbolID.Version_2525Dch1) info = lookup.getMSLInfo(id, SymbolID.Version_2525Dch1);
  const geometry = String(info?.getGeometry() || "point").toLowerCase();
  const minPoints = Math.max(1, Number(info?.getMinPointCount()) || 1);
  const rawMax = Number(info?.getMaxPointCount());
  const maxPoints = Number.isFinite(rawMax) && rawMax <= HUGE_POINT_COUNT ? Math.max(minPoints, rawMax) : null;
  let mode: DrawMode = "open";
  if (geometry === "point" || (minPoints <= 1 && (maxPoints == null || maxPoints <= 1))) mode = "point";
  else if (maxPoints != null && minPoints === maxPoints) mode = "fixed";
  const modifiers = info?.getModifiers() ?? [];
  const defaults = amplifierDefaults(Number(info?.getDrawRule()) || 0);
  const contract: SymbolContract = {
    minPoints,
    maxPoints,
    modifiers,
    mode,
    distance: modifiers.includes(Modifiers.AM_DISTANCE) ? defaults.distance : "",
    azimuth: modifiers.includes(Modifiers.AN_AZIMUTH) ? defaults.azimuth : "",
  };
  contractCache.set(key, contract);
  return contract;
}

export function defaultModifiers(basicId: string, standard: ViewOptions["standard"], reinforced = ""): ModifierText {
  const contract = symbolContract(basicId, standard);
  return {
    ...EMPTY_MODIFIERS,
    reinforcedReduced: reinforced,
    distance: contract.distance,
    azimuth: contract.azimuth,
  };
}

export function placingIsMulti(placing: Placing | null, standard: ViewOptions["standard"]) {
  if (!placing) return false;
  if (placing.mode === "generic") return placing.kind !== "pin" && placing.kind !== "text";
  return symbolContract(placing.symbol.basicId, standard).mode !== "point";
}

const BLANK = "0".repeat(30);

const AFFILIATION: Record<Affiliation, number> = {
  F: SymbolID.StandardIdentity_Affiliation_Friend,
  H: SymbolID.StandardIdentity_Affiliation_Hostile_Faker,
  N: SymbolID.StandardIdentity_Affiliation_Neutral,
  U: SymbolID.StandardIdentity_Affiliation_Unknown,
};

const STATUS: Record<Presence, number> = {
  P: SymbolID.Status_Present,
  A: SymbolID.Status_Planned_Anticipated_Suspect,
};

function echelonCode(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function headquartersCode(graphic: Pick<Graphic, "headquarters" | "taskForce" | "feint">) {
  let code = SymbolID.HQTFD_Unknown;
  if (graphic.feint) code += SymbolID.HQTFD_FeintDummy;
  if (graphic.headquarters) code += SymbolID.HQTFD_Headquarters;
  if (graphic.taskForce) code += SymbolID.HQTFD_TaskForce;
  return code;
}

export function buildSidc(graphic: Pick<Graphic, "basicId" | "affiliation" | "status" | "echelon" | "headquarters" | "taskForce" | "feint">, standard: ViewOptions["standard"]) {
  const basicId = (graphic.basicId || "").padEnd(8, "0").slice(0, 8);
  let sidc = BLANK;
  sidc = SymbolID.setVersion(sidc, standard === "APP6" ? SymbolID.Version_APP6D : SymbolID.Version_2525Dch1);
  sidc = SymbolID.setAffiliation(sidc, AFFILIATION[graphic.affiliation] ?? AFFILIATION.F);
  sidc = SymbolID.setSymbolSet(sidc, Number(basicId.slice(0, 2)) || 0);
  sidc = SymbolID.setStatus(sidc, STATUS[graphic.status] ?? STATUS.P);
  sidc = SymbolID.setHQTFD(sidc, headquartersCode(graphic));
  sidc = SymbolID.setAmplifierDescriptor(sidc, echelonCode(graphic.echelon));
  sidc = SymbolID.setEntityCode(sidc, Number(basicId.slice(2)) || 0);
  if (!SymbolUtilities.hasModifier(sidc, Modifiers.B_ECHELON)) {
    sidc = SymbolID.setAmplifierDescriptor(sidc, SymbolID.Echelon_Unknown);
  }
  const keepsIdentityAmplifier =
    SymbolUtilities.hasModifier(sidc, Modifiers.S_HQ_STAFF_INDICATOR) ||
    SymbolUtilities.hasModifier(sidc, Modifiers.D_TASK_FORCE_INDICATOR) ||
    SymbolUtilities.hasModifier(sidc, Modifiers.AB_FEINT_DUMMY_INDICATOR);
  if (!keepsIdentityAmplifier) sidc = SymbolID.setHQTFD(sidc, SymbolID.HQTFD_Unknown);
  return sidc;
}

function modifierMap(graphic: Graphic, sidc: string) {
  const map = new Map<string, string>();
  const fields: [string, string][] = [
    [Modifiers.T_UNIQUE_DESIGNATION_1, graphic.modifiers.uniqueDesignation],
    [Modifiers.M_HIGHER_FORMATION, graphic.modifiers.higherFormation],
    [Modifiers.H_ADDITIONAL_INFO_1, graphic.modifiers.additionalInformation],
    [Modifiers.G_STAFF_COMMENTS, graphic.modifiers.staffComments],
    [Modifiers.F_REINFORCED_REDUCED, graphic.modifiers.reinforcedReduced],
    [Modifiers.C_QUANTITY, graphic.modifiers.quantity],
    [Modifiers.V_EQUIP_TYPE, graphic.modifiers.type],
    [Modifiers.W_DTG_1, graphic.modifiers.dtg],
    [Modifiers.X_ALTITUDE_DEPTH, graphic.modifiers.altitudeDepth],
    [Modifiers.Q_DIRECTION_OF_MOVEMENT, graphic.modifiers.direction],
    [Modifiers.AM_DISTANCE, graphic.modifiers.distance],
    [Modifiers.AN_AZIMUTH, graphic.modifiers.azimuth],
  ];
  for (const [key, value] of fields) {
    const text = String(value || "").trim();
    if (text && SymbolUtilities.hasModifier(sidc, key)) map.set(key, text);
  }
  return map;
}

function presentSymbol(svg: string, view: ViewOptions, width = 0, height = 0) {
  let next = svg.replace(/<desc>[\s\S]*?<\/desc>/g, "").replace(/<metadata>[\s\S]*?<\/metadata>/g, "");
  next = next.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => `<svg${attrs.replace(/\s(?:width|height)="[^"]*"/g, "")}>`);
  if (!/<svg[\s>]/i.test(next) && width > 0 && height > 0) {
    next = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${next}</svg>`;
  } else if (/<svg[\s>]/i.test(next) && !/viewBox=/.test(next) && width > 0 && height > 0) {
    next = next.replace(/<svg/i, `<svg viewBox="0 0 ${width} ${height}"`);
  }
  next = /preserveAspectRatio=/.test(next)
    ? next.replace(/preserveAspectRatio="[^"]*"/, 'preserveAspectRatio="xMidYMid meet"')
    : next.replace("<svg", '<svg preserveAspectRatio="xMidYMid meet"');
  if (!view.symbolFrame) {
    next = next.replace(/<g id="0_[^"]*">[\s\S]*?<\/g>/, "");
  } else if (!view.symbolFill) {
    next = next.replace(/(<g id="0_[^"]*">[\s\S]*?<\/g>)/, (group) => group.replace(/fill="#[0-9A-Fa-f]{3,8}"/, 'fill="none"'));
  }
  return next;
}

const cache = new Map<string, DrawnSymbol | null>();

export function renderSymbol(
  graphic: Graphic,
  view: ViewOptions,
  size = view.symbolSize,
  iconOnly = false,
): DrawnSymbol | null {
  if (!graphic.basicId) return null;
  const sidc = buildSidc(graphic, view.standard);
  const key = [sidc, size, graphic.scale ?? 1, iconOnly, view.symbolFill, view.symbolFrame, view.shadow, iconOnly ? "" : JSON.stringify(graphic.modifiers)].join("|");
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const attributes = new Map<string, string>();
  const pixel = Math.max(16, Math.round(size * (canScaleGraphic(graphic) ? graphicScale(graphic) : 1)));
  attributes.set(MilStdAttributes.PixelSize, String(pixel));
  attributes.set(MilStdAttributes.KeepUnitRatio, "true");
  if (iconOnly) attributes.set(MilStdAttributes.DrawAsIcon, "true");
  if (view.shadow) attributes.set(MilStdAttributes.OutlineSymbol, "true");

  const drawn = MilStdIconRenderer.getInstance().RenderSVG(sidc, iconOnly ? new Map() : modifierMap(graphic, sidc), attributes);
  if (!drawn) {
    cache.set(key, null);
    return null;
  }
  const bounds = drawn.getImageBounds();
  const result: DrawnSymbol = {
    svg: presentSymbol(drawn.getSVG(), view, Math.max(1, bounds.getWidth()), Math.max(1, bounds.getHeight())),
    width: Math.max(1, bounds.getWidth()),
    height: Math.max(1, bounds.getHeight()),
    anchorX: drawn.getSymbolCenterX(),
    anchorY: drawn.getSymbolCenterY(),
  };
  cache.set(key, result);
  return result;
}

export function symbolAllows(graphic: Pick<Graphic, "renderer" | "basicId" | "affiliation" | "status" | "echelon" | "headquarters" | "taskForce" | "feint">, standard: ViewOptions["standard"], modifier: string) {
  if (graphic.renderer !== "symbol" || !graphic.basicId) return false;
  return SymbolUtilities.hasModifier(buildSidc(graphic, standard), modifier);
}

export const FIELD = {
  echelon: Modifiers.B_ECHELON,
  taskForce: Modifiers.D_TASK_FORCE_INDICATOR,
  headquarters: Modifiers.S_HQ_STAFF_INDICATOR,
  feint: Modifiers.AB_FEINT_DUMMY_INDICATOR,
  reinforced: Modifiers.F_REINFORCED_REDUCED,
};

export const TEXT_MODIFIERS: { key: keyof ModifierText; label: string; modifier: string }[] = [
  { key: "uniqueDesignation", label: "Unique designation", modifier: Modifiers.T_UNIQUE_DESIGNATION_1 },
  { key: "higherFormation", label: "Higher formation", modifier: Modifiers.M_HIGHER_FORMATION },
  { key: "additionalInformation", label: "Additional information", modifier: Modifiers.H_ADDITIONAL_INFO_1 },
  { key: "staffComments", label: "Staff comments", modifier: Modifiers.G_STAFF_COMMENTS },
  { key: "reinforcedReduced", label: "Reinforced / reduced", modifier: Modifiers.F_REINFORCED_REDUCED },
  { key: "quantity", label: "Quantity", modifier: Modifiers.C_QUANTITY },
  { key: "type", label: "Type", modifier: Modifiers.V_EQUIP_TYPE },
  { key: "dtg", label: "Date-time group", modifier: Modifiers.W_DTG_1 },
  { key: "altitudeDepth", label: "Altitude / depth", modifier: Modifiers.X_ALTITUDE_DEPTH },
  { key: "direction", label: "Direction (°)", modifier: Modifiers.Q_DIRECTION_OF_MOVEMENT },
  { key: "distance", label: "Distance (m)", modifier: Modifiers.AM_DISTANCE },
  { key: "azimuth", label: "Azimuth (°)", modifier: Modifiers.AN_AZIMUTH },
];

export type MapFrame = {
  west: number;
  south: number;
  east: number;
  north: number;
  width: number;
  height: number;
};

/** Formations keep their fixed frame. Every other symbol, and the bean, can be resized after it is drawn. */
export function canScaleGraphic(graphic: Pick<Graphic, "renderer" | "basicId"> & { kind?: string }) {
  if (graphic.kind === "bean") return true;
  return graphic.renderer === "symbol" && Boolean(graphic.basicId) && sectionOfBasicId(graphic.basicId) !== "formations";
}

export function graphicScale(graphic: { scale?: number }) {
  const value = graphic.scale ?? 1;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** Clockwise degrees, wrapped to -180…180. */
export function graphicRotation(graphic: { rotation?: number }) {
  const value = graphic.rotation ?? 0;
  if (!Number.isFinite(value)) return 0;
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

export function centroid(coordinates: [number, number][]): [number, number] {
  if (!coordinates.length) return [0, 0];
  const lng = coordinates.reduce((sum, point) => sum + point[0], 0) / coordinates.length;
  const lat = coordinates.reduce((sum, point) => sum + point[1], 0) / coordinates.length;
  return [lng, lat];
}

/** Visible anchors. The stored points stay put and scale grows or shrinks them around their center. */
export function scaledCoordinates(coordinates: [number, number][], scale: number): [number, number][] {
  if (coordinates.length < 2 || scale === 1) return coordinates;
  const [originX, originY] = centroid(coordinates);
  return coordinates.map(([lng, lat]) => [originX + (lng - originX) * scale, originY + (lat - originY) * scale]);
}

function eastScale(lat: number) {
  return Math.cos((lat * Math.PI) / 180) || 1;
}

/** Rotate one point around an origin. Positive degrees are counterclockwise in map space. */
export function rotateAround(origin: [number, number], point: [number, number], degrees: number): [number, number] {
  if (!degrees) return point;
  const kx = eastScale(origin[1]);
  const x = (point[0] - origin[0]) * kx;
  const y = point[1] - origin[1];
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [origin[0] + (x * cos - y * sin) / kx, origin[1] + x * sin + y * cos];
}

/** Clockwise bearing from north, in degrees. */
export function bearingFromNorth(origin: [number, number], point: [number, number]) {
  const kx = eastScale(origin[1]);
  const x = (point[0] - origin[0]) * kx;
  const y = point[1] - origin[1];
  return (Math.atan2(x, y) * 180) / Math.PI;
}

export function shownCoordinates(graphic: Graphic): [number, number][] {
  const adjustable = canScaleGraphic(graphic);
  const scale = adjustable ? graphicScale(graphic) : 1;
  const rotation = adjustable ? graphicRotation(graphic) : 0;
  if (graphic.kind === "bean" && graphic.coordinates.length >= 2) {
    const origin = graphic.coordinates[0];
    const edge = graphic.coordinates[1];
    if (scale === 1 && rotation === 0) return [origin, edge];
    const scaled: [number, number] =
      scale === 1 ? edge : [origin[0] + (edge[0] - origin[0]) * scale, origin[1] + (edge[1] - origin[1]) * scale];
    return [origin, rotateAround(origin, scaled, -rotation)];
  }
  if (graphic.coordinates.length < 2 || (scale === 1 && rotation === 0)) return graphic.coordinates;
  const origin = centroid(graphic.coordinates);
  return graphic.coordinates.map((point) => {
    const scaled: [number, number] =
      scale === 1 ? point : [origin[0] + (point[0] - origin[0]) * scale, origin[1] + (point[1] - origin[1]) * scale];
    return rotateAround(origin, scaled, -rotation);
  });
}

/** Stored anchor for a point the user dragged on the rotated, scaled symbol. */
export function toBasePoint(coordinates: [number, number][], scale: number, rotation: number, displayed: [number, number]): [number, number] {
  const origin = centroid(coordinates);
  const unrotated = rotateAround(origin, displayed, rotation);
  if (scale === 1) return unrotated;
  return [origin[0] + (unrotated[0] - origin[0]) / scale, origin[1] + (unrotated[1] - origin[1]) / scale];
}

/** A grab point just outside the symbol, along its clockwise heading. */
export function rotationHandlePosition(graphic: Graphic): [number, number] {
  const bean = graphic.kind === "bean" && graphic.coordinates.length >= 2;
  const origin = bean ? graphic.coordinates[0] : centroid(graphic.coordinates);
  const scale = canScaleGraphic(graphic) ? graphicScale(graphic) : 1;
  const kx = eastScale(origin[1]);
  let reach = 0;
  for (const point of bean ? [graphic.coordinates[1]] : graphic.coordinates) {
    const dist = Math.hypot((point[0] - origin[0]) * kx * scale, (point[1] - origin[1]) * scale);
    if (dist > reach) reach = dist;
  }
  const north: [number, number] = [origin[0], origin[1] + Math.max(reach * 1.45, 1e-4)];
  return rotateAround(origin, north, -(canScaleGraphic(graphic) ? graphicRotation(graphic) : 0));
}

/** Official frame colors: the same cyan, red, green, and yellow as unit symbols. */
export function frameColor(code: string) {
  if (code === "H") return "#FF8080";
  if (code === "N") return "#AAFFAA";
  if (code === "U") return "#FFFF80";
  return "#80E0FF";
}

function paintAffiliation(features: Feature[], affiliation: string): Feature[] {
  const color = frameColor(affiliation);
  return features.map((feature) => ({
    ...feature,
    properties: {
      ...(feature.properties || {}),
      strokeColor: color,
      fontColor: "#111111",
      ...(feature.properties?.fillColor ? { fillColor: color } : {}),
    },
  }));
}

/** Real multipoint geometry for control measures and other line or area symbols. */
export function renderControlMeasure(graphic: Graphic, view: ViewOptions, frame: MapFrame, selected: boolean): Feature[] | null {
  const shown = { ...graphic, coordinates: shownCoordinates(graphic) };
  const features = renderMeasureFeatures(shown, view, frame) ?? renderMeasureFeatures(shown, view, frameAround(shown.coordinates, frame));
  if (!features?.length) return null;
  return paintAffiliation(features, graphic.affiliation).map((feature) => {
    const dash = feature.properties?.strokeDasharray;
    return {
      ...feature,
      properties: {
        ...(feature.properties || {}),
        id: graphic.id,
        mil: 1,
        selected: selected ? 1 : 0,
        dashed: Array.isArray(dash) && dash.length ? 1 : 0,
      },
    };
  });
}

/** The renderer drops a symbol when the view spans most of the world. Draw it at the map scale inside a frame around the graphic. */
function frameAround(coordinates: [number, number][], frame: MapFrame): MapFrame {
  const lngs = coordinates.map((point) => point[0]);
  const lats = coordinates.map((point) => point[1]);
  const width = Math.max(frame.width, 1);
  const height = Math.max(frame.height, 1);
  const degPerPxX = Math.abs(frame.east - frame.west) / width || 0.05;
  const degPerPxY = Math.abs(frame.north - frame.south) / height || 0.05;
  const padX = 120 * degPerPxX;
  const padY = 120 * degPerPxY;
  const west = Math.min(...lngs) - padX;
  const east = Math.max(...lngs) + padX;
  const south = Math.min(...lats) - padY;
  const north = Math.max(...lats) + padY;
  return {
    west,
    south,
    east,
    north,
    width: Math.max(64, Math.round((east - west) / degPerPxX)),
    height: Math.max(64, Math.round((north - south) / degPerPxY)),
  };
}

const previewCache = new Map<string, string | null>();

/** Gallery thumbnail of a line or area symbol, using the same renderer as the map. */
function previewAnchors(contract: SymbolContract, kind: Graphic["kind"]): [number, number][] {
  if (contract.mode === "point") return [[5, 3]];
  const pool: [number, number][] =
    kind === "line"
      ? [
          [1, 4.2],
          [3.5, 2.2],
          [6.5, 3.6],
          [9, 1.8],
        ]
      : [
          [1.5, 1],
          [8.5, 1.2],
          [8.2, 5],
          [1.4, 4.7],
        ];
  const wanted = contract.maxPoints == null ? Math.max(contract.minPoints, Math.min(4, pool.length)) : contract.maxPoints;
  const count = Math.min(pool.length, Math.max(contract.minPoints, wanted));
  const points = pool.slice(0, Math.max(1, Math.min(pool.length, count)));
  while (points.length < contract.minPoints) {
    const last = points[points.length - 1];
    points.push([last[0] + 0.4, last[1] + 0.3]);
  }
  return points;
}

export function renderMeasurePreview(graphic: Graphic, view: ViewOptions): string | null {
  if (!graphic.basicId || graphic.kind === "point") return null;
  const contract = symbolContract(graphic.basicId, view.standard);
  const modifiers = {
    ...graphic.modifiers,
    distance: graphic.modifiers.distance || contract.distance,
    azimuth: graphic.modifiers.azimuth || contract.azimuth,
  };
  const coordinates = previewAnchors(contract, graphic.kind);
  const sidc = buildSidc(graphic, view.standard);
  const key = [sidc, coordinates.join(";"), modifiers.distance, modifiers.azimuth, JSON.stringify(graphic.modifiers)].join("|");
  const cached = previewCache.get(key);
  if (cached !== undefined) return cached;
  const features = renderMeasureFeatures(
    { ...graphic, id: "preview", coordinates, modifiers },
    view,
    { west: 0, south: 0, east: 10, north: 6, width: 220, height: 140 },
  );
  const svg = features ? featuresToSvg(paintAffiliation(features, graphic.affiliation)) : null;
  previewCache.set(key, svg);
  return svg;
}

function renderMeasureFeatures(graphic: Graphic, view: ViewOptions, frame: MapFrame): Feature[] | null {
  if (!graphic.basicId || graphic.coordinates.length < 1) return null;
  const sidc = buildSidc(graphic, view.standard);
  const controlPoints = graphic.coordinates.map(([lng, lat]) => `${lng},${lat}`).join(" ");
  const bbox = `${frame.west},${frame.south},${frame.east},${frame.north}`;
  let raw = "";
  try {
    raw = WebRenderer.RenderSymbol2D(
      graphic.id,
      graphic.name,
      "",
      sidc,
      controlPoints,
      Math.max(64, Math.round(frame.width)),
      Math.max(64, Math.round(frame.height)),
      bbox,
      modifierMap(graphic, sidc),
      new Map<string, string>(),
      WebRenderer.OUTPUT_FORMAT_GEOJSON,
    );
  } catch {
    return null;
  }
  let parsed: { type?: string; features?: Feature[] };
  try {
    parsed = JSON.parse(raw) as { type?: string; features?: Feature[] };
  } catch {
    return null;
  }
  if (parsed.type === "error" || !parsed.features) return null;
  const features = parsed.features.filter(usableMeasure);
  return features.length ? features : null;
}

function usableMeasure(feature: Feature) {
  const geometry = feature.geometry;
  if (!geometry) return false;
  if (geometry.type === "Polygon") return (geometry.coordinates[0]?.length ?? 0) >= 4;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some((polygon) => (polygon[0]?.length ?? 0) >= 4);
  if (geometry.type === "LineString") return geometry.coordinates.length >= 2;
  if (geometry.type === "MultiLineString") return geometry.coordinates.some((line) => line.length >= 2);
  if (geometry.type === "Point") return Boolean(feature.properties && String(feature.properties.label || "").trim());
  return false;
}

function featuresToSvg(features: Feature[]) {
  const width = 160;
  const height = 100;
  const west = 0;
  const south = 0;
  const east = 10;
  const north = 6;
  const project = (point: Position) => {
    const x = ((point[0] - west) / (east - west)) * width;
    const y = ((north - point[1]) / (north - south)) * height;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  };
  const parts: string[] = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const stroke = String(feature.properties?.strokeColor || "#111111");
    const fill = feature.properties?.fillColor ? String(feature.properties.fillColor) : "none";
    for (const ring of ringsOf(geometry)) {
      if (ring.length < 2) continue;
      const path = ring.map((point, index) => `${index ? "L" : "M"}${project(point)}`).join(" ");
      const close = geometry.type === "Polygon" || geometry.type === "MultiPolygon" ? " Z" : "";
      parts.push(`<path d="${path}${close}" fill="none" stroke="#000000" stroke-width="4.5" stroke-linejoin="round"/>`);
      parts.push(`<path d="${path}${close}" fill="${fill}" stroke="${stroke}" stroke-width="2.6" stroke-linejoin="round"/>`);
    }
    if (geometry.type === "Point" && feature.properties?.label) {
      parts.push(
        `<text x="${project(geometry.coordinates).split(" ")[0]}" y="${project(geometry.coordinates).split(" ")[1]}" text-anchor="middle" font-size="12" font-family="sans-serif" fill="#111111">${escapeXml(String(feature.properties.label))}</text>`,
      );
    }
  }
  if (!parts.length) return null;
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

function ringsOf(geometry: Feature["geometry"]): Position[][] {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] || ch);
}

export function affiliationColor(code: string) {
  if (code === "H") return "#d32020";
  if (code === "N") return "#2e8b2e";
  if (code === "U") return "#c6b000";
  return "#1f4bff";
}
