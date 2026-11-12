import { describe, expect, it } from "vitest";
import { markerPixels } from "./export-map";

describe("markerPixels", () => {
  it("scales a marker from screen pixels onto the canvas backing store", () => {
    expect(
      markerPixels({ left: 10, top: 20, width: 100, height: 50 }, { left: 30, top: 40, width: 20, height: 10 }, 200, 100),
    ).toEqual({ x: 40, y: 40, w: 40, h: 20 });
  });
});
