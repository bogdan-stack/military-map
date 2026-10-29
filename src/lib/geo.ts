import { forward, toPoint } from "mgrs";
import type { AngularUnit, DistanceUnit, GeoFormat } from "./types";

export function haversine(a: [number, number], b: [number, number]) {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLength(coords: [number, number][]) {
  let meters = 0;
  for (let i = 1; i < coords.length; i++) meters += haversine(coords[i - 1], coords[i]);
  return meters;
}

export function ringArea(coords: [number, number][]) {
  if (coords.length < 3) return 0;
  const ring = coords[0] === coords[coords.length - 1] ? coords : [...coords, coords[0]];
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += toRad(x2 - x1) * (2 + Math.sin(toRad(y1)) + Math.sin(toRad(y2)));
  }
  return Math.abs((sum * 6371008.8 * 6371008.8) / 2);
}

function toRad(d: number) {
  return (d * Math.PI) / 180;
}

export function formatDistance(meters: number, unit: DistanceUnit) {
  if (unit === "imperial") {
    const feet = meters * 3.28084;
    if (feet >= 5280) return `${(feet / 5280).toFixed(2)} mi`;
    return `${Math.round(feet)} ft`;
  }
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

export function formatArea(m2: number, unit: DistanceUnit) {
  if (unit === "imperial") {
    const ft2 = m2 * 10.7639;
    if (ft2 >= 27878400) return `${(ft2 / 27878400).toFixed(2)} mi²`;
    return `${Math.round(ft2).toLocaleString()} ft²`;
  }
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toFixed(2)} km²`;
  return `${Math.round(m2).toLocaleString()} m²`;
}

export function bearingDeg(a: [number, number], b: [number, number]) {
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function formatBearing(degrees: number, unit: AngularUnit) {
  const d = (degrees + 360) % 360;
  if (unit === "mils") return `${Math.round((d * 6400) / 360)} mil`;
  return `${d.toFixed(1)}°`;
}

function pad(n: number, width = 2) {
  return String(Math.floor(Math.abs(n))).padStart(width, "0");
}

export function formatLatLng(lng: number, lat: number, format: GeoFormat) {
  if (format === "mgrs") {
    try {
      return forward([lng, lat], 4);
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }
  if (format === "dms") {
    const fmt = (v: number, pos: string, neg: string) => {
      const hemi = v >= 0 ? pos : neg;
      const a = Math.abs(v);
      const deg = Math.floor(a);
      const minFloat = (a - deg) * 60;
      const min = Math.floor(minFloat);
      const sec = ((minFloat - min) * 60).toFixed(1);
      return `${pad(deg, v === lat ? 2 : 3)}°${pad(min)}'${sec}"${hemi}`;
    };
    return `${fmt(lat, "N", "S")} ${fmt(lng, "E", "W")}`;
  }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function parseCoordinate(input: string): [number, number] | null {
  const text = input.trim();
  if (!text) return null;
  const pair = text.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (pair) {
    const a = Number(pair[1]);
    const b = Number(pair[2]);
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return [b, a];
    if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return [a, b];
  }
  try {
    const point = toPoint(text.replace(/\s+/g, ""));
    if (point && point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
      return [point[0], point[1]];
    }
  } catch {
    return null;
  }
  return null;
}

export function circlePolygon(center: [number, number], edge: [number, number], steps = 64): [number, number][] {
  const radius = haversine(center, edge);
  const coords: [number, number][] = [];
  const lat = (center[1] * Math.PI) / 180;
  const lng = (center[0] * Math.PI) / 180;
  const angDist = radius / 6371008.8;
  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(
      Math.sin(lat) * Math.cos(angDist) + Math.cos(lat) * Math.sin(angDist) * Math.cos(bearing),
    );
    const lng2 =
      lng +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angDist) * Math.cos(lat),
        Math.cos(angDist) - Math.sin(lat) * Math.sin(lat2),
      );
    coords.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return coords;
}

export function rectPolygon(a: [number, number], b: [number, number]): [number, number][] {
  return [
    [a[0], a[1]],
    [b[0], a[1]],
    [b[0], b[1]],
    [a[0], b[1]],
    [a[0], a[1]],
  ];
}
