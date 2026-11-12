import { describe, expect, it } from "vitest";
import { placesFromPhoton } from "./places";

describe("placesFromPhoton", () => {
  it("reads a city name, country, center, and bounds", () => {
    const places = placesFromPhoton({
      features: [
        {
          geometry: { coordinates: [26.102684, 44.4361414] },
          properties: {
            osm_type: "R",
            osm_id: 377733,
            osm_value: "city",
            name: "Bucharest",
            state: "București",
            country: "Romania",
            extent: [25.9666745, 44.5413964, 26.2255768, 44.3342466],
          },
        },
      ],
    });
    expect(places).toEqual([
      {
        id: "R:377733",
        name: "Bucharest",
        detail: "București, Romania",
        center: [26.102684, 44.4361414],
        zoom: 11,
        bounds: [
          [25.9666745, 44.3342466],
          [26.2255768, 44.5413964],
        ],
      },
    ]);
  });

  it("drops features without coordinates", () => {
    expect(placesFromPhoton({ features: [{ properties: { name: "Nowhere" } }] })).toEqual([]);
    expect(placesFromPhoton(null)).toEqual([]);
  });
});
