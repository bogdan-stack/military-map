import { z } from "zod";
import { DEFAULT_OPTIONS } from "@/lib/types";
import { stableStringify } from "./diff";

const layerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .passthrough();

const graphicSchema = z
  .object({
    id: z.string().min(1),
    layerId: z.string().min(1),
  })
  .passthrough();

export const exportSchema = z
  .object({
    layers: z.array(layerSchema),
    graphics: z.array(graphicSchema),
    activeLayerId: z.string().nullable().optional(),
    options: z.record(z.string(), z.unknown()).optional(),
    favorites: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type ParsedExport = z.infer<typeof exportSchema>;

const KNOWN_TOP_LEVEL = new Set(["layers", "graphics", "activeLayerId", "options", "favorites"]);

export function parseExport(input: unknown): { document: ParsedExport; unknownTopLevel: string[] } {
  const document = exportSchema.parse(input);
  const unknownTopLevel =
    input && typeof input === "object"
      ? Object.keys(input as Record<string, unknown>).filter((key) => !KNOWN_TOP_LEVEL.has(key))
      : [];
  return { document, unknownTopLevel };
}

export type LayerSummary = { id: string; name: string; graphics: number };

export function summarizeExport(document: {
  layers: { id: string; name?: string }[];
  graphics: { layerId: string }[];
}): LayerSummary[] {
  return document.layers.map((layer) => ({
    id: layer.id,
    name: layer.name ?? "",
    graphics: document.graphics.filter((graphic) => graphic.layerId === layer.id).length,
  }));
}

export function documentHasWork(doc: {
  layers: { name?: string }[];
  graphics: unknown[];
  favorites: unknown[];
  options: object;
}): boolean {
  if (doc.graphics.length > 0) return true;
  if (doc.favorites.length > 0) return true;
  if (doc.layers.length !== 1) return true;
  if (doc.layers[0]?.name !== "New Layer") return true;
  return stableStringify(doc.options) !== stableStringify(DEFAULT_OPTIONS);
}
