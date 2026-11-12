import { describe, expect, it } from "vitest";
import { findAmbiguousTimes, findDtgs, formatInstant, formatWallClock } from "./dtg";
import { buildReading } from "./reading";
import { analyseOrder } from "./structure";

const FIXTURE = `OPERATION STEEL MERIDIAN
OPORD 04-26

References:
a. 1 MN DIV OPORD 04-26
f. 1 MN DIV Signal Instructions

1. SITUATION
a. Area of operations. 1 MN DIV attacks west of the Salva.

2. MISSION
2 MN BDE attacks in the northern zone NLT 190600B NOV 26 to seize OBJ FALCON.

3. EXECUTION
a. Timeline. Order received 121000B NOV 26.
b. Tasks to units.
(2) Movement.
(d) Move to attack positions not earlier than 180200B NOV 26.

4. SERVICE SUPPORT
Nothing at this time.

5. COMMAND AND SIGNAL
Nothing at this time.

ANNEX C
2. Operations overlay
a. Detail at 35TNL4521661000.
`;

describe("DTG", () => {
  it("reads 180200B NOV 26 as 18 Nov 2026, 02:00, zone B", () => {
    const [parsed] = findDtgs("not earlier than 180200B NOV 26");
    expect(parsed.day).toBe(18);
    expect(parsed.hour).toBe(2);
    expect(parsed.minute).toBe(0);
    expect(parsed.zone).toBe("B");
    expect(parsed.offsetHours).toBe(2);
    expect(parsed.month).toBe(11);
    expect(parsed.year).toBe(2026);
    expect(parsed.qualifier).toBe("NET");
    expect(formatWallClock(parsed.year, parsed.month, parsed.day, parsed.hour, parsed.minute)).toBe("Wed 18 Nov, 02:00");
    expect(formatInstant(parsed.utcMs, parsed.offsetHours)).toBe("Wed 18 Nov, 02:00");
  });

  it("reads the receipt and H-hour from the worked example", () => {
    const parsed = findDtgs("121000B NOV 26 and 190600B NOV 26");
    expect(parsed.map((item) => [item.day, item.hour])).toEqual([[12, 10], [19, 6]]);
    expect(parsed.every((item) => item.zone === "B" && item.year === 2026)).toBe(true);
  });

  it("keeps a time with no month as ambiguous", () => {
    const text = "not earlier than 180200B";
    expect(findDtgs(text)).toHaveLength(0);
    expect(findAmbiguousTimes(text, []).map((item) => item.raw)).toEqual(["180200B"]);
  });
});

describe("order structure", () => {
  it("builds paragraph 3.b.(2) and an annex namespace", () => {
    const structure = analyseOrder(FIXTURE);
    expect(structure.blocks.map((block) => block.anchor)).toEqual(expect.arrayContaining(["3.b.(2)", "ANX-C/2.a"]));
    expect(structure.paragraphCount).toBe(5);
    expect(structure.annexes).toEqual(["C"]);
  });
});

describe("reading checks", () => {
  it("reports reference F when that file was not uploaded", () => {
    const report = buildReading([{ name: "1MNDIV_OPORD_04-26.pdf", text: FIXTURE, pageCount: 4, ocrPages: 0 }]);
    expect(report.missingReferences.map((item) => item.letter)).toContain("F");
    expect(report.missingReferences.find((item) => item.letter === "F")?.title).toBe("1 MN DIV Signal Instructions");
    expect(report.timezone).toMatchObject({ letter: "B", offsetHours: 2, name: "BRAVO", consistent: true });
    expect(report.identity.operationName).toBe("Steel Meridian");
    expect(report.identity.ownUnit).toBe("2 MN BDE");
    expect(report.identity.fromUnit).toBe("1 MN DIV");
    const move = report.times.find((time) => time.raw.startsWith("180200B"));
    expect(move?.anchor).toBe("3.b.(2)(d)");
    expect(move?.localLabel).toBe("Wed 18 Nov, 02:00");
  });

  it("clears reference F when an annex file covers it", () => {
    const report = buildReading([
      { name: "OPORD.docx", text: FIXTURE, pageCount: 1, ocrPages: 0 },
      { name: "ANX-F_Signal_Instructions.docx", text: "", pageCount: 1, ocrPages: 0 },
    ]);
    expect(report.missingReferences.map((item) => item.letter)).not.toContain("F");
  });

  it("marks a time uncertain when the OCR confidence is low", () => {
    const report = buildReading([{
      name: "scan.png",
      text: "Move not earlier than 180200B NOV 26.",
      pageCount: 1,
      ocrPages: 1,
      words: [{ text: "180200B", confidence: 42 }],
    }]);
    expect(report.uncertainTimes).toHaveLength(1);
    expect(report.uncertainTimes[0].localLabel).toBe("Wed 18 Nov, 02:00");
  });
});
