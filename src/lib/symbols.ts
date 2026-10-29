import {
  MilStdAttributes,
  MilStdIconRenderer,
  Modifiers,
  SymbolID,
} from "@armyc2.c5isr.renderer/mil-sym-ts-web";
import type { Affiliation, Graphic, Presence, ViewOptions } from "./types";

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

function headquartersCode(graphic: Pick<Graphic, "headquarters" | "taskForce">) {
  if (graphic.headquarters && graphic.taskForce) return SymbolID.HQTFD_TaskForce_Headquarters;
  if (graphic.headquarters) return SymbolID.HQTFD_Headquarters;
  if (graphic.taskForce) return SymbolID.HQTFD_TaskForce;
  return SymbolID.HQTFD_Unknown;
}

export function buildSidc(graphic: Pick<Graphic, "basicId" | "affiliation" | "status" | "echelon" | "headquarters" | "taskForce">, standard: ViewOptions["standard"]) {
  const basicId = (graphic.basicId || "").padEnd(8, "0").slice(0, 8);
  let sidc = BLANK;
  sidc = SymbolID.setVersion(sidc, standard === "APP6" ? SymbolID.Version_APP6D : SymbolID.Version_2525Dch1);
  sidc = SymbolID.setAffiliation(sidc, AFFILIATION[graphic.affiliation] ?? AFFILIATION.F);
  sidc = SymbolID.setSymbolSet(sidc, Number(basicId.slice(0, 2)) || 0);
  sidc = SymbolID.setStatus(sidc, STATUS[graphic.status] ?? STATUS.P);
  sidc = SymbolID.setHQTFD(sidc, headquartersCode(graphic));
  sidc = SymbolID.setAmplifierDescriptor(sidc, echelonCode(graphic.echelon));
  sidc = SymbolID.setEntityCode(sidc, Number(basicId.slice(2)) || 0);
  return sidc;
}

function modifierMap(graphic: Graphic) {
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
    if (text) map.set(key, text);
  }
  return map;
}

function presentSymbol(svg: string, view: ViewOptions) {
  let next = svg.replace(/<desc>[\s\S]*?<\/desc>/g, "").replace(/<metadata>[\s\S]*?<\/metadata>/g, "");
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
  if (iconOnly) attributes.set(MilStdAttributes.DrawAsIcon, "true");
  if (view.shadow) attributes.set(MilStdAttributes.OutlineSymbol, "true");

  const drawn = MilStdIconRenderer.getInstance().RenderSVG(sidc, iconOnly ? new Map() : modifierMap(graphic), attributes);
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

export function affiliationColor(code: string) {
  if (code === "H") return "#d32020";
  if (code === "N") return "#2e8b2e";
  if (code === "U") return "#c6b000";
  return "#1f4bff";
}
