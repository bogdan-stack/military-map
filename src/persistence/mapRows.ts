import { aliasesFromRows, resolveAppId, type AliasTable } from "./ids";

const LAYER_KEYS = new Set(["id", "name", "visible", "locked"]);
const GRAPHIC_KEYS = new Set([
  "id",
  "layerId",
  "name",
  "renderer",
  "kind",
  "basicId",
  "affiliation",
  "status",
  "echelon",
  "headquarters",
  "taskForce",
  "feint",
  "color",
  "scale",
  "rotation",
  "coordinates",
  "modifiers",
]);

export type LayerRow = {
  id: string;
  legacy_id: string | null;
  name: string;
  visible: boolean;
  locked: boolean;
  sort_order: number;
  extra: Record<string, unknown>;
};

export type GraphicRow = {
  id: string;
  layer_id: string;
  legacy_id: string | null;
  name: string;
  renderer: string;
  kind: string;
  basic_id: string;
  affiliation: string;
  status: string;
  echelon: string;
  headquarters: boolean;
  task_force: boolean;
  feint: boolean;
  color: string;
  scale: number | null;
  rotation: number | null;
  coordinates: unknown;
  modifiers: Record<string, unknown>;
  extra: Record<string, unknown>;
  sort_order: number;
};

export type WorkspaceRows = {
  activeLayerId: string | null;
  layers: LayerRow[];
  graphics: GraphicRow[];
};

type LooseLayerRow = {
  id: string;
  legacy_id: string | null;
  name: string;
  visible: boolean;
  locked: boolean;
  sort_order: number;
  extra: unknown;
};

type LooseGraphicRow = {
  id: string;
  layer_id: string;
  legacy_id: string | null;
  name: string;
  renderer: string;
  kind: string;
  basic_id: string;
  affiliation: string;
  status: string;
  echelon: string;
  headquarters: boolean;
  task_force: boolean;
  feint: boolean;
  color: string;
  scale: number | string | null;
  rotation: number | string | null;
  coordinates: unknown;
  modifiers: unknown;
  extra: unknown;
  sort_order: number;
};

export type AppDocument = {
  layers: Record<string, unknown>[];
  graphics: Record<string, unknown>[];
  activeLayerId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function extras(source: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!known.has(key) && value !== undefined) extra[key] = value;
  }
  return extra;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalNumber(source: Record<string, unknown>, key: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(source, key) || source[key] == null) return null;
  const value = source[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return JSON.parse(value) as number;
  return null;
}

/** Postgres `numeric` often comes back as a string. Parse it without reformatting. */
export function numericFromDb(value: number | string | null | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") return value;
  return JSON.parse(value) as number;
}

function coordinatesFromDb(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((pair) => {
    if (!Array.isArray(pair)) return pair;
    return pair.map((item) => (typeof item === "string" ? (JSON.parse(item) as number) : item));
  });
}

export function workspaceToRows(
  doc: {
    layers: object[];
    graphics: object[];
    activeLayerId?: string | null;
  },
  aliases: AliasTable,
): WorkspaceRows {
  const layers: LayerRow[] = doc.layers.map((layer, index) => {
    const source = asRecord(layer);
    const resolved = resolveAppId(text(source.id), aliases);
    return {
      id: resolved.id,
      legacy_id: resolved.legacyId,
      name: text(source.name),
      visible: source.visible !== false,
      locked: source.locked === true,
      sort_order: index,
      extra: extras(source, LAYER_KEYS),
    };
  });
  const appLayerToUuid = new Map<string, string>();
  doc.layers.forEach((layer, index) => {
    appLayerToUuid.set(text(asRecord(layer).id), layers[index].id);
  });

  const graphics: GraphicRow[] = doc.graphics.map((graphic, index) => {
    const source = asRecord(graphic);
    const resolved = resolveAppId(text(source.id), aliases);
    const layerAppId = text(source.layerId);
    const layerId = appLayerToUuid.get(layerAppId) ?? aliases.get(layerAppId) ?? layerAppId;
    return {
      id: resolved.id,
      layer_id: layerId,
      legacy_id: resolved.legacyId,
      name: text(source.name),
      renderer: text(source.renderer),
      kind: text(source.kind),
      basic_id: text(source.basicId),
      affiliation: text(source.affiliation),
      status: text(source.status),
      echelon: text(source.echelon),
      headquarters: source.headquarters === true,
      task_force: source.taskForce === true,
      feint: source.feint === true,
      color: text(source.color),
      scale: optionalNumber(source, "scale"),
      rotation: optionalNumber(source, "rotation"),
      coordinates: source.coordinates ?? [],
      modifiers: asRecord(source.modifiers),
      extra: extras(source, GRAPHIC_KEYS),
      sort_order: index,
    };
  });

  let activeLayerId: string | null = null;
  if (doc.activeLayerId) {
    activeLayerId = appLayerToUuid.get(doc.activeLayerId) ?? null;
  }

  return { activeLayerId, layers, graphics };
}

export function rowsToDocument(
  activeLayerId: string | null,
  layers: LooseLayerRow[],
  graphics: LooseGraphicRow[],
): AppDocument {
  const orderedLayers = [...layers].sort((left, right) => left.sort_order - right.sort_order);
  const orderedGraphics = [...graphics].sort((left, right) => left.sort_order - right.sort_order);
  const layerAppId = new Map(orderedLayers.map((layer) => [layer.id, layer.legacy_id ?? layer.id]));

  return {
    activeLayerId: activeLayerId ? layerAppId.get(activeLayerId) ?? activeLayerId : null,
    layers: orderedLayers.map((layer) => ({
      ...asRecord(layer.extra),
      id: layer.legacy_id ?? layer.id,
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
    })),
    graphics: orderedGraphics.map((graphic) => {
      const scale = numericFromDb(graphic.scale);
      const rotation = numericFromDb(graphic.rotation);
      const restored: Record<string, unknown> = {
        ...asRecord(graphic.extra),
        id: graphic.legacy_id ?? graphic.id,
        layerId: layerAppId.get(graphic.layer_id) ?? graphic.layer_id,
        name: graphic.name,
        renderer: graphic.renderer,
        kind: graphic.kind,
        basicId: graphic.basic_id,
        affiliation: graphic.affiliation,
        status: graphic.status,
        echelon: graphic.echelon,
        headquarters: graphic.headquarters,
        taskForce: graphic.task_force,
        feint: graphic.feint,
        color: graphic.color,
        coordinates: coordinatesFromDb(graphic.coordinates),
        modifiers: asRecord(graphic.modifiers),
      };
      if (scale !== undefined) restored.scale = scale;
      else delete restored.scale;
      if (rotation !== undefined) restored.rotation = rotation;
      else delete restored.rotation;
      return restored;
    }),
  };
}

export function mergeAliases(layers: LooseLayerRow[], graphics: LooseGraphicRow[]): AliasTable {
  return aliasesFromRows([
    ...layers.map((layer) => ({ id: layer.id, legacy_id: layer.legacy_id })),
    ...graphics.map((graphic) => ({ id: graphic.id, legacy_id: graphic.legacy_id })),
  ]);
}
