import { describe, expect, it, vi } from "vitest";
import { canvasToPng } from "./render-tile";

describe("canvas export", () => {
  it("does not export a canvas that has no context or no size", async () => {
    const convertToBlob = vi.fn(() => Promise.reject(new Error("should not be called")));
    const empty = await canvasToPng({ width: 0, height: 0, getContext: () => null, convertToBlob } as unknown as OffscreenCanvas);
    const noContext = await canvasToPng({
      width: 8,
      height: 8,
      getContext: () => null,
      convertToBlob,
    } as unknown as OffscreenCanvas);
    expect(convertToBlob).not.toHaveBeenCalled();
    expect(new Uint8Array(empty)[0]).toBe(0x89);
    expect(new Uint8Array(noContext)[0]).toBe(0x89);
  });

  it("obtains a 2D context before convertToBlob", async () => {
    const order: string[] = [];
    const canvas = {
      width: 2,
      height: 2,
      getContext: () => {
        order.push("context");
        return {};
      },
      convertToBlob: async () => {
        order.push("blob");
        return new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])]);
      },
    };
    const buffer = await canvasToPng(canvas as unknown as OffscreenCanvas);
    expect(order).toEqual(["context", "blob"]);
    expect(new Uint8Array(buffer)[0]).toBe(0x89);
  });
});
