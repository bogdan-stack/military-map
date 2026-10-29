import maplibregl, { type AddProtocolAction } from "maplibre-gl";
import { renderHatchTile } from "./render-tile";
import type { GroundCondition, MovementClass } from "./classify";

const cache = new Map<string, ArrayBuffer>();
const inflight = new Map<string, Promise<ArrayBuffer>>();
const MAX_TILES = 120;

const loadCoo: AddProtocolAction = async (params, abortController) => {
  const match = /coo:\/\/overlay\/v\d+\/(\d+)\/(\d+)\/(\d+)\/(tracked|wheeled|foot)\/(dry|wet|mud|snow|frozen)/.exec(params.url);
  if (!match) return { data: await blank() };
  const z = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  const movement = match[4] as MovementClass;
  const ground = match[5] as GroundCondition;
  try {
    return { data: await cachedTile(z, x, y, movement, ground, abortController.signal) };
  } catch (error) {
    if (abortController.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    return { data: await blank() };
  }
};

function cachedTile(
  z: number,
  x: number,
  y: number,
  movement: MovementClass,
  ground: GroundCondition,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const key = `v7/${z}/${x}/${y}/${movement}/${ground}`;
  const ready = cache.get(key);
  if (ready) return Promise.resolve(ready);
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = renderHatchTile(z, x, y, movement, ground, signal)
    .then((buffer) => {
      inflight.delete(key);
      if (signal.aborted) return buffer;
      cache.set(key, buffer);
      while (cache.size > MAX_TILES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return buffer;
    })
    .catch((error: unknown) => {
      inflight.delete(key);
      throw error;
    });
  inflight.set(key, task);
  return task;
}

let blankTile: Promise<ArrayBuffer> | null = null;

function blank(): Promise<ArrayBuffer> {
  blankTile ??= (async () => {
    const canvas = new OffscreenCanvas(1, 1);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return blob.arrayBuffer();
  })();
  return blankTile;
}

/** Registers the browser tile source. Later calls replace the handler so a reload picks up renderer changes. */
export function ensureCooProtocol() {
  if (typeof window === "undefined") return;
  maplibregl.addProtocol("coo", loadCoo);
}
