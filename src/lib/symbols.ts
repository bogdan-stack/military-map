import {
  MilStdAttributes,
  MilStdIconRenderer,
  Modifiers,
  SymbolID,
  SymbolUtilities,
  WebRenderer,
} from "@armyc2.c5isr.renderer/mil-sym-ts-web";
import type { Feature, Position } from "geojson";
import type { Affiliation, Graphic, Modifiers as ModifierText, Presence, ViewOptions } from "./types";

export type DrawnSymbol = {
  svg: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
};

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
  ];
  for (const [key, value] of fields) {
    const text = value.trim();
    if (text && SymbolUtilities.hasModifier(sidc, key)) map.set(key, text);
  }
  return map;
}

function presentSymbol(svg: string, view: ViewOptions) {
  let next = svg
    .replace(/<desc>[\s\S]*?<\/desc>/g, "")
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, "")
    .replace(/\s(?:width|height)="[^"]*"/g, "");
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
  const key = [sidc, size, iconOnly, view.symbolFill, view.symbolFrame, view.shadow, iconOnly ? "" : JSON.stringify(graphic.modifiers)].join("|");
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const attributes = new Map<string, string>();
  attributes.set(MilStdAttributes.PixelSize, String(Math.max(16, Math.round(size))));
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
    svg: presentSymbol(drawn.getSVG(), view),
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
];

export type MapFrame = {
  west: number;
  south: number;
  east: number;
  north: number;
  width: number;
  height: number;
};

/** Real multipoint geometry for control measures and other line or area symbols. */
export function renderControlMeasure(graphic: Graphic, view: ViewOptions, frame: MapFrame, selected: boolean): Feature[] | null {
  const features = renderMeasureFeatures(graphic, view, frame) ?? renderMeasureFeatures(graphic, view, frameAround(graphic.coordinates, frame));
  if (!features?.length) return null;
  return features.map((feature) => {
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
export function renderMeasurePreview(graphic: Graphic, view: ViewOptions): string | null {
  if (!graphic.basicId || graphic.kind === "point") return null;
  const sidc = buildSidc(graphic, view.standard);
  const key = [sidc, graphic.kind, JSON.stringify(graphic.modifiers)].join("|");
  const cached = previewCache.get(key);
  if (cached !== undefined) return cached;
  const coordinates: [number, number][] =
    graphic.kind === "area"
      ? [
          [1.5, 1],
          [8.5, 1.2],
          [8.2, 5],
          [1.4, 4.7],
        ]
      : [
          [1, 4.2],
          [3.5, 2.2],
          [6.5, 3.6],
          [9, 1.8],
        ];
  const features = renderMeasureFeatures(
    { ...graphic, id: "preview", coordinates },
    view,
    { west: 0, south: 0, east: 10, north: 6, width: 220, height: 140 },
  );
  const svg = features ? featuresToSvg(features) : null;
  previewCache.set(key, svg);
  return svg;
}

function renderMeasureFeatures(graphic: Graphic, view: ViewOptions, frame: MapFrame): Feature[] | null {
  if (!graphic.basicId || graphic.coordinates.length < 2) return null;
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
      parts.push(`<path d="${path}${close}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`);
    }
    if (geometry.type === "Point" && feature.properties?.label) {
      parts.push(
        `<text x="${project(geometry.coordinates).split(" ")[0]}" y="${project(geometry.coordinates).split(" ")[1]}" text-anchor="middle" font-size="12" font-family="sans-serif" fill="${stroke}">${escapeXml(String(feature.properties.label))}</text>`,
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
