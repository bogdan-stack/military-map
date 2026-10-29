import { MSLookup, SymbolID } from "@armyc2.c5isr.renderer/mil-sym-ts-web";
import type { CatalogSymbol } from "./types";

type Section = CatalogSymbol["section"];

const FORMATIONS = new Set([
  SymbolID.SymbolSet_Air,
  SymbolID.SymbolSet_AirMissile,
  SymbolID.SymbolSet_Space,
  SymbolID.SymbolSet_SpaceMissile,
  SymbolID.SymbolSet_LandUnit,
  SymbolID.SymbolSet_LandCivilianUnit_Organization,
  SymbolID.SymbolSet_DismountedIndividuals,
  SymbolID.SymbolSet_SeaSurface,
  SymbolID.SymbolSet_SeaSubsurface,
  SymbolID.SymbolSet_CyberSpace,
]);

function sectionFor(symbolSet: number): Section {
  if (
    symbolSet === SymbolID.SymbolSet_LandEquipment ||
    symbolSet === SymbolID.SymbolSet_LandInstallation ||
    symbolSet === SymbolID.SymbolSet_MineWarfare
  ) {
    return "equipment";
  }
  if (symbolSet === SymbolID.SymbolSet_ControlMeasure) return "tactical";
  if (
    symbolSet === SymbolID.SymbolSet_SignalsIntelligence ||
    symbolSet === SymbolID.SymbolSet_SignalsIntelligence_Space ||
    symbolSet === SymbolID.SymbolSet_SignalsIntelligence_Air ||
    symbolSet === SymbolID.SymbolSet_SignalsIntelligence_Land ||
    symbolSet === SymbolID.SymbolSet_SignalsIntelligence_SeaSurface ||
    symbolSet === SymbolID.SymbolSet_SignalsIntelligence_SeaSubsurface
  ) {
    return "signals";
  }
  if (symbolSet === SymbolID.SymbolSet_Activities) return "stability";
  if (
    symbolSet === SymbolID.SymbolSet_Atmospheric ||
    symbolSet === SymbolID.SymbolSet_Oceanographic ||
    symbolSet === SymbolID.SymbolSet_MeteorologicalSpace
  ) {
    return "emergency";
  }
  if (FORMATIONS.has(symbolSet)) return "formations";
  return "formations";
}

function kindOf(geometry: string): CatalogSymbol["kind"] {
  const value = geometry.toLowerCase();
  if (value === "line") return "line";
  if (value === "area") return "area";
  return "point";
}

let cache: CatalogSymbol[] | null = null;

/** Official MIL-STD-2525D Change 1 catalogue from the Army symbol renderer. */
export function getCatalog(): CatalogSymbol[] {
  if (cache) return cache;
  const lookup = MSLookup.getInstance();
  const version = SymbolID.Version_2525Dch1;
  const out: CatalogSymbol[] = [];
  for (const basicId of lookup.getIDList(version)) {
    const info = lookup.getMSLInfo(basicId, version);
    if (!info) continue;
    const name = info.getName().trim();
    if (!name) continue;
    const parts = info
      .getPath()
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    const category = parts[1] || parts[0] || "General";
    const subcategory = (parts[2] || name).trim();
    out.push({
      id: info.getBasicSymbolID(),
      name,
      category,
      subcategory,
      section: sectionFor(info.getSymbolSet()),
      basicId: info.getBasicSymbolID(),
      kind: kindOf(info.getGeometry() || "point"),
    });
  }
  cache = out;
  return out;
}

export function groupCatalog(symbols: CatalogSymbol[]) {
  const categories = new Map<string, Map<string, CatalogSymbol[]>>();
  for (const symbol of symbols) {
    if (!categories.has(symbol.category)) categories.set(symbol.category, new Map());
    const sub = categories.get(symbol.category)!;
    if (!sub.has(symbol.subcategory)) sub.set(symbol.subcategory, []);
    sub.get(symbol.subcategory)!.push(symbol);
  }
  return categories;
}
