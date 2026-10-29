export type Affiliation = "F" | "H" | "N" | "U";
export type Presence = "P" | "A";
export type DrawKind = "point" | "line" | "area" | "pin" | "text" | "rect" | "circle";
export type SectionId =
  | "favorites"
  | "formations"
  | "equipment"
  | "tactical"
  | "signals"
  | "stability"
  | "emergency";

export type CatalogSymbol = {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  section: Exclude<SectionId, "favorites">;
  codingscheme: string;
  battledimension: string;
  functionid: string;
  kind: "point" | "line" | "area";
};

export type Modifiers = {
  uniqueDesignation: string;
  higherFormation: string;
  additionalInformation: string;
  staffComments: string;
  reinforcedReduced: string;
  quantity: string;
  type: string;
  dtg: string;
  altitudeDepth: string;
  direction: string;
};

export type Graphic = {
  id: string;
  layerId: string;
  name: string;
  renderer: "symbol" | "generic";
  kind: DrawKind;
  codingscheme: string;
  battledimension: string;
  functionid: string;
  affiliation: Affiliation;
  status: Presence;
  echelon: string;
  headquarters: boolean;
  taskForce: boolean;
  color: string;
  coordinates: [number, number][];
  modifiers: Modifiers;
};

export type MapLayer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
};

export type GeoFormat = "decimal" | "dms" | "mgrs";
export type DistanceUnit = "metric" | "imperial";
export type AngularUnit = "degree" | "mils";
export type MapType = "terrain" | "streets" | "satellite";
export type Standard = "2525" | "APP6";

export type ViewOptions = {
  standard: Standard;
  theme: "light" | "dark";
  hints: boolean;
  distanceUnit: DistanceUnit;
  angularUnit: AngularUnit;
  geoFormat: GeoFormat;
  mapType: MapType;
  brightness: number;
  hue: number;
  chroma: number;
  coordinateSearch: boolean;
  measure: boolean;
  cursorCoordinate: boolean;
  showScale: boolean;
  grid: boolean;
  symbolSize: number;
  symbolFill: boolean;
  symbolFrame: boolean;
  shadow: boolean;
  strokeWidth: number;
};

export type Placing =
  | { mode: "symbol"; symbol: CatalogSymbol }
  | { mode: "generic"; kind: "pin" | "text" | "line" | "area" | "rect" | "circle"; name: string };

export type LeftPanel = "layers" | "active" | "print" | "options" | null;
export type RightPanel = "gallery" | "editor" | "points" | null;

export const EMPTY_MODIFIERS: Modifiers = {
  uniqueDesignation: "",
  higherFormation: "",
  additionalInformation: "",
  staffComments: "",
  reinforcedReduced: "",
  quantity: "",
  type: "",
  dtg: "",
  altitudeDepth: "",
  direction: "",
};

export const DEFAULT_OPTIONS: ViewOptions = {
  standard: "2525",
  theme: "light",
  hints: true,
  distanceUnit: "metric",
  angularUnit: "degree",
  geoFormat: "decimal",
  mapType: "terrain",
  brightness: 0,
  hue: 0,
  chroma: 100,
  coordinateSearch: false,
  measure: false,
  cursorCoordinate: true,
  showScale: true,
  grid: false,
  symbolSize: 28,
  symbolFill: true,
  symbolFrame: true,
  shadow: true,
  strokeWidth: 3,
};

export const ECHELONS: { code: string; label: string }[] = [
  { code: "-", label: "None" },
  { code: "A", label: "Team / crew" },
  { code: "B", label: "Squad" },
  { code: "C", label: "Section" },
  { code: "D", label: "Platoon / detachment" },
  { code: "E", label: "Company / battery / troop" },
  { code: "F", label: "Battalion / squadron" },
  { code: "G", label: "Regiment / group" },
  { code: "H", label: "Brigade" },
  { code: "I", label: "Division" },
  { code: "J", label: "Corps / MEF" },
  { code: "K", label: "Army" },
  { code: "L", label: "Army group / front" },
  { code: "M", label: "Region / theater" },
  { code: "N", label: "Command" },
];

export const AFFILIATIONS: { code: Affiliation; label: string }[] = [
  { code: "F", label: "Friend" },
  { code: "H", label: "Hostile" },
  { code: "N", label: "Neutral" },
  { code: "U", label: "Unknown" },
];
