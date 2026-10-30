import { DrawRules, MilStdIconRenderer, MilStdAttributes, MSLookup, SymbolID } from "@armyc2.c5isr.renderer/mil-sym-ts-web";
import { createExpression, type StylePropertySpecification } from "@maplibre/maplibre-gl-style-spec";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCatalog } from "./catalog";
import { buildSidc, coalescedNumber, dropNullProperties, renderMeasurePreview, renderSymbol, symbolContract } from "./symbols";
import { DEFAULT_OPTIONS, EMPTY_MODIFIERS, type Affiliation, type Graphic, type ViewOptions } from "./types";

const APP6: ViewOptions = { ...DEFAULT_OPTIONS, standard: "APP6" };
const MIL: ViewOptions = { ...DEFAULT_OPTIONS, standard: "2525" };

const LISTED = [
  "100346000012030000000000000000",
  "100346000012030900000000000000",
  "100346000012060000000000000000",
  "100346000012061100000000000000",
  "100346000014010000000000000000",
  "100346000013010000000000000000",
  "100346000011080100000000000000",
  "100346000011080300000000000000",
  "100646000013010000000000000000",
  "100646000014010000000000000000",
  "100446000013010000000000000000",
  "100446000014010000000000000000",
];

function affiliationOf(sidc: string): Affiliation {
  if (sidc[3] === "6") return "H";
  if (sidc[3] === "4") return "N";
  if (sidc[3] === "1") return "U";
  return "F";
}

function basicOf(sidc: string) {
  return sidc.slice(4, 6) + sidc.slice(10, 16);
}

function makeGraphic(basicId: string, affiliation: Affiliation, kind: Graphic["kind"] = "point"): Graphic {
  return {
    id: basicId + affiliation,
    layerId: "layer",
    name: basicId,
    renderer: "symbol",
    kind,
    basicId,
    affiliation,
    status: "P",
    echelon: "00",
    headquarters: false,
    taskForce: false,
    feint: false,
    color: "#1f4bff",
    coordinates: [
      [26, 47],
      [26.2, 47.1],
      [26.15, 46.9],
    ],
    modifiers: { ...EMPTY_MODIFIERS },
  };
}

function libraryErrors(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.flat().map((value) => String((value as { message?: string })?.message || value));
}

describe("symbol rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the version code of symbols that exist in the selected standard", () => {
    const lookup = MSLookup.getInstance();
    const shared = lookup
      .getIDList(SymbolID.Version_APP6D)
      .find((id) => lookup.getMSLInfo(id, SymbolID.Version_2525Dch1) && !String(id).startsWith("4"));
    expect(shared).toBeTruthy();
    const app6 = buildSidc(makeGraphic(String(shared), "F"), "APP6");
    const mil = buildSidc(makeGraphic(String(shared), "F"), "2525");
    expect(app6.slice(0, 2)).toBe(String(SymbolID.Version_APP6D).padStart(2, "0"));
    expect(mil.slice(0, 2)).toBe(String(SymbolID.Version_2525Dch1).padStart(2, "0"));
    expect(app6.slice(2)).toBe(mil.slice(2));
    const icon = renderSymbol(makeGraphic(String(shared), "F"), APP6, 48, false);
    const direct = MilStdIconRenderer.getInstance().RenderSVG(app6, new Map(), new Map([[MilStdAttributes.PixelSize, "48"], [MilStdAttributes.KeepUnitRatio, "true"], [MilStdAttributes.OutlineSymbol, "true"]]));
    expect(icon?.svg).toContain("<svg");
    expect(direct?.getSVG()).toContain("<svg");
    expect(icon?.svg.length).toBeGreaterThan(80);
  });

  it("renders every reported SIDC without the lookup crash", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lookup = MSLookup.getInstance();
    const unknown = renderSymbol(makeGraphic("99999999", "F"), APP6, 40, false);
    const basics = new Set(LISTED.map(basicOf));
    for (let entity = 120600; entity <= 121100; entity += 1) basics.add(`46${String(entity).padStart(6, "0")}`);

    for (const sidc of LISTED) basics.add(basicOf(sidc));
    const cases: { basicId: string; affiliation: Affiliation }[] = [
      ...LISTED.map((sidc) => ({ basicId: basicOf(sidc), affiliation: affiliationOf(sidc) })),
      ...[...basics].filter((basicId) => !LISTED.some((sidc) => basicOf(sidc) === basicId)).map((basicId) => ({ basicId, affiliation: "F" as const })),
    ];

    for (const { basicId, affiliation } of cases) {
      const info = lookup.getMSLInfo(basicId, SymbolID.Version_2525Dch1) || lookup.getMSLInfo(basicId, SymbolID.Version_2525E);
      const graphic = makeGraphic(basicId, affiliation, "point");
      const before = warnings.mock.calls.length;
      const contract = symbolContract(basicId, "APP6");
      if (contract.mode === "point") {
        const drawn = renderSymbol(graphic, APP6, 40, false);
        renderSymbol(graphic, APP6, 40, false);
        expect(drawn?.svg).toContain("<svg");
        const drawable = Boolean(info) && info?.getDrawRule() !== DrawRules.DONOTDRAW;
        if (drawable) expect(drawn?.svg).not.toBe(unknown?.svg);
        else expect(drawn?.svg).toBe(unknown?.svg);
        const added = warnings.mock.calls.length - before;
        expect(added).toBe(drawable ? 0 : 1);
      } else {
        const kind = String(info?.getGeometry() || "").toLowerCase() === "line" ? "line" : "area";
        const preview = renderMeasurePreview({ ...graphic, kind }, APP6);
        expect(preview).toContain("<svg");
        expect(warnings.mock.calls.length - before).toBe(0);
      }
      const resolved = buildSidc(graphic, "APP6");
      if (info) expect(resolved.slice(0, 2)).not.toBe("10");
    }

    expect(libraryErrors(errors).some((line) => line.includes("getDrawRule"))).toBe(false);
    expect(getCatalog().some((symbol) => symbol.basicId === "46120300" || symbol.basicId === "46120600")).toBe(false);
  });

  it("drops null feature properties and coerces null style numbers", () => {
    expect(dropNullProperties({ strokeWidth: null, textRotate: 12, label: null, name: "A" })).toEqual({
      textRotate: 12,
      name: "A",
    });
    const numberSpec = { type: "number" } as StylePropertySpecification;
    for (const [field, fallback] of [
      ["textSize", 13],
      ["textRotate", 0],
      ["render_height", 0],
      ["strokeWidth", 2],
    ] as const) {
      const created = createExpression(coalescedNumber(field, fallback), numberSpec);
      expect(created.result).not.toBe("error");
      if (created.result === "error") continue;
      const globals = { zoom: 0 } as never;
      expect(created.value.evaluate(globals, { properties: { [field]: null } } as never)).toBe(fallback);
      expect(created.value.evaluate(globals, { properties: {} } as never)).toBe(fallback);
    }
  });

  it("still draws a 2525 icon the same way for a symbol in that standard", () => {
    const graphic = makeGraphic("46120309", "F");
    const mil = renderSymbol(graphic, MIL, 40, false);
    const app6 = renderSymbol(graphic, APP6, 40, false);
    expect(buildSidc(graphic, "2525").slice(0, 2)).toBe("11");
    expect(buildSidc(graphic, "APP6").slice(0, 2)).toBe("11");
    expect(mil?.svg).toContain("<svg");
    expect(app6?.svg).toBe(mil?.svg);
  });
});
