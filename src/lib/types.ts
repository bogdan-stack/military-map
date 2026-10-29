export type Affiliation = "F" | "H" | "N" | "U";
export type Presence = "P" | "A";
export type DrawKind = "point" | "line" | "area" | "pin" | "text" | "rect" | "circle" | "bean";
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
  /** Symbol set + entity code, 8 digits, from MIL-STD-2525D. */
  basicId: string;
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
  /** AM. Comma-separated meters: width, radius, or a pair of radii. */
  distance: string;
  /** AN. Comma-separated degrees. */
  azimuth: string;
};

export type Graphic = {
  id: string;
  layerId: string;
  name: string;
  renderer: "symbol" | "generic";
  kind: DrawKind;
  /** Symbol set + entity code. Empty for generic drawings. */
  basicId: string;
  affiliation: Affiliation;
  status: Presence;
  echelon: string;
  headquarters: boolean;
  taskForce: boolean;
  /** Feint or dummy, SIDC headquarters/task-force/dummy field. */
  feint: boolean;
  color: string;
  /** Size multiplier for symbols other than formations. 1 is the size as drawn. */
  scale?: number;
  /** Clockwise rotation in degrees for symbols other than formations. */
  rotation?: number;
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
  | { mode: "generic"; kind: "pin" | "text" | "line" | "area" | "rect" | "circle" | "bean"; name: string };

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
  distance: "",
  azimuth: "",
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
  symbolSize: 40,
  symbolFill: true,
  symbolFrame: true,
  shadow: true,
  strokeWidth: 3,
};

export const ECHELONS: { code: string; label: string }[] = [
  { code: "00", label: "None" },
  { code: "11", label: "Team / crew (Ø)" },
  { code: "12", label: "Squad (•)" },
  { code: "13", label: "Section (••)" },
  { code: "14", label: "Platoon / detachment (•••)" },
  { code: "15", label: "Company / battery / troop (I)" },
  { code: "16", label: "Battalion / squadron (II)" },
  { code: "17", label: "Regiment / group (III)" },
  { code: "18", label: "Brigade (X)" },
  { code: "21", label: "Division (XX)" },
  { code: "22", label: "Corps / MEF (XXX)" },
  { code: "23", label: "Army (XXXX)" },
  { code: "24", label: "Army group / front (XXXXX)" },
  { code: "25", label: "Region / theater (XXXXXX)" },
  { code: "26", label: "Command (++)" },
];

export const AFFILIATIONS: { code: Affiliation; label: string }[] = [
  { code: "F", label: "Friend" },
  { code: "H", label: "Hostile" },
  { code: "N", label: "Neutral" },
  { code: "U", label: "Unknown" },
];
