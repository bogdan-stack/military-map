import ms from "milsymbol";
import type { Graphic, ViewOptions } from "./types";

export function buildSidc(graphic: Pick<
  Graphic,
  | "codingscheme"
  | "affiliation"
  | "battledimension"
  | "status"
  | "functionid"
  | "echelon"
  | "headquarters"
  | "taskForce"
>) {
  let amplifier = "-";
  if (graphic.headquarters && graphic.taskForce) amplifier = "B";
  else if (graphic.headquarters) amplifier = "A";
  else if (graphic.taskForce) amplifier = "E";
  const fn = (graphic.functionid || "------").padEnd(6, "-").slice(0, 6);
  const echelon = (graphic.echelon || "-").slice(0, 1) || "-";
  return (
    graphic.codingscheme.slice(0, 1) +
    graphic.affiliation.slice(0, 1) +
    graphic.battledimension.slice(0, 1) +
    graphic.status.slice(0, 1) +
    fn +
    amplifier +
    echelon
  )
    .padEnd(15, "-")
    .slice(0, 15);
}

export function renderSymbol(graphic: Graphic, view: ViewOptions, size = view.symbolSize) {
  const direction = graphic.modifiers.direction.trim();
  const symbol = new ms.Symbol(buildSidc(graphic), {
    size,
    fill: view.symbolFill,
    frame: view.symbolFrame,
    standard: view.standard,
    strokeWidth: view.strokeWidth,
    outlineWidth: view.shadow ? 2 : 0,
    outlineColor: view.theme === "dark" ? "#111" : "#fff",
    uniqueDesignation: graphic.modifiers.uniqueDesignation,
    higherFormation: graphic.modifiers.higherFormation,
    additionalInformation: graphic.modifiers.additionalInformation,
    staffComments: graphic.modifiers.staffComments,
    reinforcedReduced: graphic.modifiers.reinforcedReduced,
    quantity: graphic.modifiers.quantity,
    type: graphic.modifiers.type,
    dtg: graphic.modifiers.dtg,
    altitudeDepth: graphic.modifiers.altitudeDepth,
    direction: direction === "" || Number.isNaN(Number(direction)) ? undefined : Number(direction),
    infoFields: true,
  });
  return symbol;
}

export function affiliationColor(code: string) {
  if (code === "H") return "#d32020";
  if (code === "N") return "#2e8b2e";
  if (code === "U") return "#c6b000";
  return "#1f4bff";
}
