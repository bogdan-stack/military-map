import type { Map } from "maplibre-gl";

export type PixelBox = { x: number; y: number; w: number; h: number };

/** Map a marker's screen box onto the map canvas backing store. */
export function markerPixels(
  mapBox: { left: number; top: number; width: number; height: number },
  markerBox: { left: number; top: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
): PixelBox {
  const scaleX = mapBox.width > 0 ? canvasWidth / mapBox.width : 1;
  const scaleY = mapBox.height > 0 ? canvasHeight / mapBox.height : 1;
  return {
    x: (markerBox.left - mapBox.left) * scaleX,
    y: (markerBox.top - mapBox.top) * scaleY,
    w: markerBox.width * scaleX,
    h: markerBox.height * scaleY,
  };
}

/** Basemap, obstacle overlay, and drawn lines, with the symbol markers painted on top. */
export async function exportMapPng(map: Map): Promise<string> {
  await settle(map);
  const gl = map.getCanvas();
  const out = document.createElement("canvas");
  out.width = gl.width;
  out.height = gl.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("The map canvas could not be exported.");
  ctx.drawImage(gl, 0, 0);
  const mapBox = gl.getBoundingClientRect();
  const markers = [...map.getContainer().querySelectorAll<HTMLElement>(".symbol-marker")];
  for (const marker of markers) await paintMarker(ctx, marker, mapBox, gl.width, gl.height);
  return out.toDataURL("image/png");
}

function settle(map: Map): Promise<void> {
  const ready = map.isStyleLoaded() && !map.isMoving() && map.areTilesLoaded();
  const painted = ready
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const done = () => {
          if (!map.areTilesLoaded() || map.isMoving()) return;
          map.off("idle", done);
          resolve();
        };
        map.on("idle", done);
      });
  return painted.then(
    () =>
      new Promise((resolve) => {
        map.triggerRepaint();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function paintMarker(
  ctx: CanvasRenderingContext2D,
  marker: HTMLElement,
  mapBox: DOMRect,
  canvasWidth: number,
  canvasHeight: number,
) {
  const box = marker.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return;
  const dest = markerPixels(mapBox, box, canvasWidth, canvasHeight);
  const svg = marker.querySelector("svg");
  if (svg) {
    const image = await svgImage(svg, box.width, box.height);
    if (image) ctx.drawImage(image, dest.x, dest.y, dest.w, dest.h);
    return;
  }
  const pin = marker.querySelector<HTMLElement>(".map-pin");
  if (pin) {
    const pinBox = pin.getBoundingClientRect();
    drawPin(ctx, markerPixels(mapBox, pinBox, canvasWidth, canvasHeight), getComputedStyle(pin).backgroundColor);
  }
  const label = marker.querySelector<HTMLElement>(".map-pin-label, .map-text");
  if (label) drawLabel(ctx, label, markerPixels(mapBox, label.getBoundingClientRect(), canvasWidth, canvasHeight));
}

function svgImage(svg: SVGElement, width: number, height: number): Promise<HTMLImageElement | null> {
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute("width", String(Math.max(1, Math.round(width))));
  clone.setAttribute("height", String(Math.max(1, Math.round(height))));
  const xml = new XMLSerializer().serializeToString(clone);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  return image.decode().then(
    () => image,
    () => null,
  );
}

function drawPin(ctx: CanvasRenderingContext2D, box: PixelBox, fill: string) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = fill || "#1565c0";
  ctx.strokeStyle = "#111";
  ctx.lineWidth = Math.max(1, box.w * 0.14);
  const radius = box.w / 2;
  ctx.beginPath();
  ctx.moveTo(-radius, -radius);
  ctx.arcTo(radius, -radius, radius, radius, radius);
  ctx.arcTo(radius, radius, -radius, radius, radius);
  ctx.arcTo(-radius, radius, -radius, -radius, radius);
  ctx.arcTo(-radius, -radius, radius, -radius, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, label: HTMLElement, box: PixelBox) {
  const text = (label.textContent || "").trim();
  if (!text) return;
  const size = Math.max(10, box.h * 0.7);
  ctx.save();
  ctx.font = `600 ${size}px sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 1;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = "#111";
  ctx.textBaseline = "middle";
  ctx.fillText(text, box.x + 4, box.y + box.h / 2);
  ctx.restore();
}
