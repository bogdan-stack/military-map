/** Mobility classes and the combined-obstacle hatch. Same bands as the terrain grid: unrestricted, restricted, severely restricted, no-go. */

export type MovementClass = "tracked" | "wheeled" | "foot";
export type GroundCondition = "dry" | "wet" | "mud" | "snow" | "frozen";

export const MOVEMENTS: { id: MovementClass; label: string }[] = [
  { id: "tracked", label: "Tracked" },
  { id: "wheeled", label: "Wheeled" },
  { id: "foot", label: "Foot" },
];

export const GROUNDS: { id: GroundCondition; label: string }[] = [
  { id: "dry", label: "Dry" },
  { id: "wet", label: "Wet" },
  { id: "mud", label: "Mud" },
  { id: "snow", label: "Snow" },
  { id: "frozen", label: "Frozen" },
];

export const COVER = {
  open: 0,
  grass: 1,
  crop: 2,
  tree: 3,
  shrub: 4,
  wetland: 5,
  ice: 6,
  built: 7,
  water: 8,
  roadMinor: 9,
  roadMajor: 10,
} as const;

export type CoverId = (typeof COVER)[keyof typeof COVER];

type RGBA = [number, number, number, number];

const GREEN: RGBA = [26, 140, 60, 215];
const GREEN_TINT: RGBA = [26, 140, 60, 34];
const BLACK: RGBA = [20, 20, 20, 225];
const BLUE: RGBA = [30, 110, 210, 225];
const BLUE_TINT: RGBA = [30, 110, 210, 40];

function slopeClass(slopeDeg: number, movement: MovementClass): number {
  const [restricted, severe, nogo] = movement === "wheeled" ? [8, 15, 25] : movement === "tracked" ? [15, 25, 35] : [25, 35, 45];
  return slopeDeg >= nogo ? 3 : slopeDeg >= severe ? 2 : slopeDeg >= restricted ? 1 : 0;
}

function coverClass(cover: CoverId, movement: MovementClass): number {
  if (cover === COVER.wetland) return movement === "foot" ? 2 : 3;
  if (cover === COVER.tree) return movement === "wheeled" ? 2 : 1;
  if (cover === COVER.shrub) return movement === "wheeled" ? 2 : movement === "tracked" ? 1 : 0;
  if (cover === COVER.built) return movement === "foot" ? 0 : 1;
  if (cover === COVER.ice) return 2;
  if (cover === COVER.crop) return movement === "wheeled" ? 1 : 0;
  return 0;
}

/** 0 unrestricted, 1 restricted, 2 severely restricted, 3 no-go, before weather. */
export function mobilityClass(cover: CoverId, slopeDeg: number, movement: MovementClass): number {
  if (cover === COVER.roadMajor) return 0;
  const slope = slopeClass(slopeDeg, movement);
  if (cover === COVER.roadMinor) return movement === "foot" ? 0 : Math.min(1, slope);
  if (cover === COVER.water) return 3;
  const trees = cover === COVER.tree && movement === "tracked" && slopeDeg >= 10 ? 2 : coverClass(cover, movement);
  return Math.max(slope, trees);
}

/** Ground conditions. Roads and no-go cells stay as they are. */
export function adjustedClass(cover: CoverId, base: number, movement: MovementClass, ground: GroundCondition): number {
  if (base >= 3 || cover === COVER.roadMajor || cover === COVER.roadMinor) return base;
  const soft = cover === COVER.crop || cover === COVER.grass || cover === COVER.wetland;
  if (ground === "mud") return Math.min(3, base + (movement === "foot" ? 0 : soft ? 2 : 1));
  if (ground === "wet") return Math.min(3, base + (movement === "wheeled" && soft ? 1 : 0));
  if (ground === "snow") return Math.min(3, base + 1);
  if (ground === "frozen" && cover === COVER.wetland) return Math.max(1, base - 1);
  return base;
}

/** 0 open, 1 restricted, 2 severely restricted, 3 built-up, 4 water. The outline follows changes between these. */
export function obstacleZone(cover: CoverId, cls: number): number {
  if (cover === COVER.water || (cover === COVER.wetland && cls >= 2)) return 4;
  if (cover === COVER.built) return 3;
  if (cls <= 0) return 0;
  return cls === 1 ? 1 : 2;
}

/** One overlay pixel. Null leaves the map visible. The pattern is aligned on the world tile grid. */
export function hatchColor(cover: CoverId, cls: number, gx: number, gy: number): RGBA | null {
  const diagonal = (gx + gy) % 10 < 3;
  const cross = diagonal || (((gx - gy) % 10) + 10) % 10 < 3;
  const water = cover === COVER.water || (cover === COVER.wetland && cls >= 2);
  if (water) return cross ? BLUE : BLUE_TINT;
  if (cover === COVER.built) return cross ? BLACK : null;
  if (cls <= 0) return null;
  if (cls === 1) return diagonal ? GREEN : null;
  return cross ? GREEN : GREEN_TINT;
}
