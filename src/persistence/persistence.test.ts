import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diffRecords, stableStringify } from "./diff";
import { parseExport, summarizeExport } from "./document";
import { isUuid } from "./ids";
import { numericFromDb, rowsToDocument, workspaceToRows } from "./mapRows";

const modifiers = {
  uniqueDesignation: "",
  uniqueDesignation2: "",
  higherFormation: "",
  additionalInformation: "",
  staffComments: "",
  reinforcedReduced: "",
  quantity: "",
  type: "",
  dtg: "",
  altitudeDepth: "",
  direction: "",
  distance: "",
  azimuth: "",
};

function sampleDocument() {
  return {
    layers: [
      { id: "layer-new", name: "ZO", visible: true, locked: false, zone: "north" },
      { id: "589b79f2-e537-4a7c-84fd-b360cc104791", name: "ECOA1", visible: true, locked: false },
    ],
    graphics: [
      {
        id: "90d2954b-b6e5-4766-8d84-8a6ff6fd1c9d",
        layerId: "layer-new",
        name: "Forward Line of Troops",
        renderer: "symbol",
        kind: "line",
        basicId: "25140100",
        affiliation: "F",
        status: "P",
        echelon: "17",
        headquarters: false,
        taskForce: false,
        feint: false,
        color: "#1f4bff",
        scale: 1,
        rotation: 0,
        coordinates: [[26.09869083945884, 47.45698525542031]],
        modifiers: { ...modifiers, uniqueDesignation: "20" },
      },
      {
        id: "8a9ea810-381b-44b3-b126-299e8dfe11d1",
        layerId: "589b79f2-e537-4a7c-84fd-b360cc104791",
        name: "Bean",
        renderer: "generic",
        kind: "bean",
        basicId: "",
        affiliation: "H",
        status: "P",
        echelon: "15",
        headquarters: false,
        taskForce: false,
        feint: false,
        color: "#FF8080",
        coordinates: [
          [26.339879884275263, 47.59120387235441],
          [26.38338046418815, 47.603433086984694],
        ],
        modifiers: { ...modifiers },
        scale: 0.25,
        rotation: -151.8279716112679,
        note: "keep-me",
      },
    ],
    activeLayerId: "589b79f2-e537-4a7c-84fd-b360cc104791",
    options: { standard: "APP6", grid: true },
    favorites: [] as string[],
  };
}

describe("workspace mapping", () => {
  it("round-trips app state, including layer-new and unknown fields", () => {
    const original = sampleDocument();
    const aliases = new Map<string, string>();
    const rows = workspaceToRows(original, aliases);
    const again = workspaceToRows(original, aliases);

    expect(isUuid(rows.layers[0].id)).toBe(true);
    expect(rows.layers[0].legacy_id).toBe("layer-new");
    expect(rows.layers[0].extra).toEqual({ zone: "north" });
    expect(rows.layers[0].id).toBe(again.layers[0].id);
    expect(rows.graphics[1].extra).toEqual({ note: "keep-me" });
    expect(rows.graphics[1].scale).toBe(0.25);
    expect(JSON.stringify(rows.graphics[1].rotation)).toBe("-151.8279716112679");
    expect(JSON.stringify((rows.graphics[0].coordinates as number[][])[0][0])).toBe("26.09869083945884");

    const restored = rowsToDocument(rows.activeLayerId, rows.layers, rows.graphics);
    expect(restored.activeLayerId).toBe(original.activeLayerId);
    expect(stableStringify(restored.layers)).toBe(stableStringify(original.layers));
    expect(stableStringify(restored.graphics)).toBe(stableStringify(original.graphics));
  });

  it("keeps a numeric string from Postgres identical to the original token", () => {
    expect(JSON.stringify(numericFromDb("-151.8279716112679"))).toBe("-151.8279716112679");
    expect(JSON.stringify(numericFromDb("26.09869083945884"))).toBe("26.09869083945884");
    expect(numericFromDb(null)).toBeUndefined();
  });

  it("omits scale and rotation when the drawing never had them", () => {
    const doc = sampleDocument();
    delete (doc.graphics[0] as { scale?: number }).scale;
    delete (doc.graphics[0] as { rotation?: number }).rotation;
    const rows = workspaceToRows(doc, new Map());
    expect(rows.graphics[0].scale).toBeNull();
    expect(rows.graphics[0].rotation).toBeNull();
    const restored = rowsToDocument(rows.activeLayerId, rows.layers, rows.graphics);
    expect(restored.graphics[0]).not.toHaveProperty("scale");
    expect(restored.graphics[0]).not.toHaveProperty("rotation");
  });
});

describe("save diff", () => {
  it("upserts changed rows and deletes removed ones", () => {
    const before = [
      { id: "a", name: "ZO" },
      { id: "b", name: "ZRI" },
    ];
    const after = [
      { id: "b", name: "ZRI" },
      { id: "c", name: "ECOA1" },
    ];
    expect(diffRecords(before, after)).toEqual({
      upsert: [{ id: "c", name: "ECOA1" }],
      remove: ["a"],
    });
  });

  it("treats a renamed layer as an upsert and ignores key order", () => {
    const before = [{ id: "a", name: "ZO", visible: true }];
    const after = [{ visible: true, name: "ZO", id: "a" }];
    expect(diffRecords(before, after)).toEqual({ upsert: [], remove: [] });
    expect(diffRecords(before, [{ id: "a", name: "ZRI", visible: true }]).upsert).toHaveLength(1);
  });
});

describe("export schema", () => {
  it("keeps unknown fields and reports unknown top-level keys", () => {
    const { document, unknownTopLevel } = parseExport({
      layers: [{ id: "layer-new", name: "ZO", visible: true, locked: false }],
      graphics: [{ id: "90d2954b-b6e5-4766-8d84-8a6ff6fd1c9d", layerId: "layer-new", note: "keep" }],
      activeLayerId: "layer-new",
      options: { standard: "APP6", extraFlag: true },
      favorites: [],
      sync: { pending: true },
    });
    expect(unknownTopLevel).toEqual(["sync"]);
    expect(document.graphics[0]).toMatchObject({ note: "keep" });
    expect(document.options).toMatchObject({ extraFlag: true });
  });

  it("remaps the seed file without dropping graphics", () => {
    const file = path.join(process.cwd(), "seed", "localstorage-export.json");
    const parsed = parseExport(JSON.parse(readFileSync(file, "utf8")));
    const summary = summarizeExport(parsed.document);
    expect(summary).toHaveLength(5);
    expect(summary.reduce((sum, layer) => sum + layer.graphics, 0)).toBe(29);
    expect(summary.map((layer) => [layer.name, layer.graphics])).toEqual([
      ["ZO", 3],
      ["ZRI", 0],
      ["ZII", 0],
      ["ECOA1", 26],
      ["ECOA2", 0],
    ]);

    const aliases = new Map<string, string>();
    const rows = workspaceToRows(parsed.document, aliases);
    const restored = rowsToDocument(rows.activeLayerId, rows.layers, rows.graphics);
    expect(restored.layers[0].id).toBe("layer-new");
    expect(restored.activeLayerId).toBe("589b79f2-e537-4a7c-84fd-b360cc104791");
    expect(stableStringify(restored.layers)).toBe(stableStringify(parsed.document.layers));
    expect(stableStringify(restored.graphics)).toBe(stableStringify(parsed.document.graphics));
    const bean = restored.graphics.find((graphic) => graphic.id === "8a9ea810-381b-44b3-b126-299e8dfe11d1");
    expect(JSON.stringify(bean?.rotation)).toBe("-151.8279716112679");
    const line = restored.graphics[0].coordinates as number[][];
    expect(JSON.stringify(line[0][0])).toBe("26.09869083945884");
  });
});
