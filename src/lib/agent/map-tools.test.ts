import { describe, expect, it } from "vitest";
import { createMapToolState, runMapTool, searchSymbols } from "./map-tools";

describe("map agent tools", () => {
  it("finds an infantry symbol and stages it without touching the map", () => {
    const hits = searchSymbols("friendly infantry company", 3);
    expect(hits.hits[0]?.basicId).toMatch(/^\d{8}$/);
    expect(hits.hits[0]?.affiliation).toBe("F");
    expect(hits.hits[0]?.echelon).toBe("15");
    const state = createMapToolState([]);
    const placed = runMapTool("add_symbol", state, {
      basicId: hits.hits[0].basicId,
      position: "35TNL4521661000",
      affiliation: "F",
      echelon: "15",
      designation: "B/2",
    });
    expect(placed).toMatchObject({ ok: true, handle: "N1" });
    expect(state.live).toHaveLength(0);
    const proposal = runMapTool("submit_changeset", state, { summary: "Infantry company at the grid." });
    expect(proposal).toMatchObject({ ok: true, status: "pending_review" });
  });

  it("refuses a coordinate the tools cannot read", () => {
    const state = createMapToolState([]);
    expect(runMapTool("resolve_position", state, { position: "not a grid" })).toMatchObject({ ok: false, error: "bad_position" });
  });

  it("undoes a staged symbol", () => {
    const [hit] = searchSymbols("infantry", 1).hits;
    const state = createMapToolState([]);
    runMapTool("add_symbol", state, { basicId: hit.basicId, position: "35TNL4521661000" });
    expect(runMapTool("undo", state, {})).toMatchObject({ ok: true, removed: 1 });
    expect(state.staged).toHaveLength(0);
    expect(runMapTool("submit_changeset", state, { summary: "Nothing left." })).toMatchObject({ error: "empty" });
  });
});
