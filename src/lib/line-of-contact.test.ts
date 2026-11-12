import { describe, expect, it } from "vitest";
import { renderControlMeasure } from "./symbols";
import { DEFAULT_OPTIONS, EMPTY_MODIFIERS, type Graphic } from "./types";

function lineOfContact(affiliation: Graphic["affiliation"]): Graphic {
  return {
    id: "lc",
    layerId: "layer",
    name: "Line of Contact",
    renderer: "symbol",
    kind: "line",
    basicId: "25140200",
    affiliation,
    status: "P",
    echelon: "",
    headquarters: false,
    taskForce: false,
    feint: false,
    color: "#80E0FF",
    coordinates: [
      [1, 1],
      [8, 4],
    ],
    modifiers: EMPTY_MODIFIERS,
  };
}

describe("line of contact", () => {
  it("paints the upper line with the enemy color and the other line with the chosen affiliation", () => {
    const features = renderControlMeasure(lineOfContact("F"), DEFAULT_OPTIONS, { west: 0, south: 0, east: 10, north: 6, width: 220, height: 140 }, false);
    const lines = (features ?? []).filter((feature) => feature.geometry?.type === "MultiLineString" || feature.geometry?.type === "LineString");
    const strokes = lines.map((feature) => String(feature.properties?.strokeColor));
    expect(strokes).toContain("#FF8080");
    expect(strokes).toContain("#80E0FF");
    const upper = lines.find((feature) => feature.properties?.strokeColor === "#FF8080");
    const own = lines.find((feature) => feature.properties?.strokeColor === "#80E0FF");
    expect(meanLat(upper)).toBeGreaterThan(meanLat(own));
  });
});

function meanLat(feature: { geometry?: { coordinates?: unknown } } | undefined) {
  const points: number[] = [];
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") points.push(Number(value[1]));
    else value.forEach(walk);
  };
  walk(feature?.geometry?.coordinates);
  return points.reduce((sum, lat) => sum + lat, 0) / points.length;
}
