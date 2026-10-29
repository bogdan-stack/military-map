import { ms2525c } from "mil-std-2525";
import type { CatalogSymbol } from "./types";

type RawIcon = {
  hierarchy?: string;
  names?: string[];
  codingscheme?: string;
  battledimension?: string;
  functionid?: string;
  name?: string;
  geometry?: string;
};

type Section = CatalogSymbol["section"];

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/(^|[\s/(])([a-z])/g, (m) => m.toUpperCase());
}

function kindOf(geometry: string | undefined): CatalogSymbol["kind"] {
  const g = (geometry || "").toUpperCase();
  if (g === "LINE" || g === "MULTIPOINT") return "line";
  if (g === "POLYGON") return "area";
  return "point";
}

function collect(node: unknown, section: Section, out: CatalogSymbol[]) {
  if (!node || typeof node !== "object") return;
  const record = node as { mainIcon?: RawIcon[] } & Record<string, unknown>;
  if (Array.isArray(record.mainIcon)) {
    for (const row of record.mainIcon) {
      const functionid = (row.functionid || "").trim();
      if (!functionid || /^-+$/.test(functionid)) continue;
      const names = (row.names || []).map((n) => (n || "").trim()).filter(Boolean);
      const name = titleCase((row.name || functionid).trim());
      const category = titleCase(names[2] || names[1] || names[0] || section);
      const subcategory = titleCase(names[3] || names[names.length - 1] || name);
      const id = (row.hierarchy || `${section}-${functionid}-${out.length}`).trim();
      out.push({
        id,
        name,
        category,
        subcategory,
        section,
        codingscheme: (row.codingscheme || "S").trim().slice(0, 1) || "S",
        battledimension: (row.battledimension || "G").trim().slice(0, 1) || "G",
        functionid: functionid.padEnd(6, "-").slice(0, 6),
        kind: kindOf(row.geometry),
      });
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "name" || key === "mainIcon" || key === "symbolset" || key === "modifier1" || key === "modifier2") {
      continue;
    }
    if (value && typeof value === "object") collect(value, section, out);
  }
}

let cache: CatalogSymbol[] | null = null;

/** Full MIL-STD-2525C catalogue from the `mil-std-2525` dataset. */
export function getCatalog(): CatalogSymbol[] {
  if (cache) return cache;
  const standard = ms2525c as unknown as {
    WAR: Record<string, unknown>;
    TACGRP: unknown;
    SIGINT: unknown;
    STBOPS: unknown;
    EMS: unknown;
  };
  const out: CatalogSymbol[] = [];
  collect(standard.WAR.GRDTRK_UNT, "formations", out);
  collect(standard.WAR.SOFUNT, "formations", out);
  collect(standard.WAR.AIRTRK, "formations", out);
  collect(standard.WAR.SSUF, "formations", out);
  collect(standard.WAR.SBSUF, "formations", out);
  collect(standard.WAR.SPC, "formations", out);
  collect(standard.WAR.GRDTRK_EQT, "equipment", out);
  collect(standard.WAR.GRDTRK_INS, "equipment", out);
  collect(standard.TACGRP, "tactical", out);
  collect(standard.SIGINT, "signals", out);
  collect(standard.STBOPS, "stability", out);
  collect(standard.EMS, "emergency", out);
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
