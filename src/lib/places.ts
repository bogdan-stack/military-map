export type Place = {
  id: string;
  name: string;
  detail: string;
  center: [number, number];
  zoom: number;
  bounds?: [[number, number], [number, number]];
};

const PLACE_TAGS = ["place:city", "place:town", "place:municipality", "place:village", "place:country", "place:state"];

const ZOOM: Record<string, number> = {
  country: 5,
  state: 6,
  city: 11,
  town: 12,
  municipality: 12,
  village: 14,
};

type PhotonFeature = {
  geometry?: { coordinates?: unknown };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    country?: string;
    state?: string;
    county?: string;
    city?: string;
    osm_value?: string;
    extent?: unknown;
  };
};

export function placesFromPhoton(data: unknown): Place[] {
  const features = (data as { features?: PhotonFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const places: Place[] = [];
  for (const feature of features) {
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const props = feature.properties ?? {};
    const name = props.name || props.city || props.state || props.country || "Unnamed place";
    const detail = [props.county, props.state, props.country].filter((part, index, all) => {
      return Boolean(part) && part !== name && all.indexOf(part) === index;
    }).join(", ");
    const kind = props.osm_value ?? "";
    const extent = Array.isArray(props.extent) ? props.extent.map(Number) : [];
    const bounds = extent.length === 4 && extent.every(Number.isFinite)
      ? ([[extent[0], extent[3]], [extent[2], extent[1]]] as [[number, number], [number, number]])
      : undefined;
    places.push({
      id: `${props.osm_type ?? "N"}:${props.osm_id ?? places.length}`,
      name,
      detail,
      center: [lng, lat],
      zoom: ZOOM[kind] ?? 11,
      bounds,
    });
  }
  return places;
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const text = query.trim();
  if (text.length < 2) return [];
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", text);
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", "en");
  for (const tag of PLACE_TAGS) url.searchParams.append("osm_tag", tag);
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Place search failed");
  return placesFromPhoton(await response.json());
}
