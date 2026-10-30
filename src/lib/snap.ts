import type { Map } from "maplibre-gl";
import type { Graphic } from "./types";

const SNAP_PX = 12;

/** Snap a pointer to a nearby vertex of a graphic that is not being dragged. */
export function snapLngLat(
  map: Map,
  lng: number,
  lat: number,
  graphics: Graphic[],
  skip: Set<string>,
  extras: [number, number][] = [],
): [number, number] {
  let best: [number, number] | null = null;
  let bestPx = SNAP_PX;
  const origin = map.project([lng, lat]);
  const consider = (coord: [number, number]) => {
    const point = map.project(coord);
    const dist = Math.hypot(point.x - origin.x, point.y - origin.y);
    if (dist <= bestPx) {
      bestPx = dist;
      best = coord;
    }
  };
  for (const graphic of graphics) {
    if (skip.has(graphic.id)) continue;
    for (const coord of graphic.coordinates) consider([coord[0], coord[1]]);
  }
  for (const coord of extras) consider(coord);
  return best ?? [lng, lat];
}
