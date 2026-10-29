"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import { affiliationColor, centroid, defaultModifiers, frameColor, symbolContract } from "./symbols";
import {
  AFFILIATIONS,
  DEFAULT_OPTIONS,
  EMPTY_MODIFIERS,
  type Affiliation,
  type CatalogSymbol,
  type Presence,
  type Graphic,
  type LeftPanel,
  type MapLayer,
  type Modifiers,
  type Placing,
  type RightPanel,
  type SectionId,
  type ViewOptions,
} from "./types";

const STORAGE_KEY = "military-map-v2";

type Snapshot = {
  layers: MapLayer[];
  graphics: Graphic[];
  activeLayerId: string;
};

export type MapState = {
  layers: MapLayer[];
  graphics: Graphic[];
  activeLayerId: string;
  selectedId: string | null;
  left: LeftPanel;
  right: RightPanel;
  placing: Placing | null;
  draft: [number, number][];
  measurePts: [number, number][];
  options: ViewOptions;
  favorites: string[];
  past: Snapshot[];
  future: Snapshot[];
  infoOpen: boolean;
  cursor: [number, number] | null;
  query: string;
  gallerySection: SectionId;
  galleryAffiliation: Affiliation;
  galleryEchelon: string;
  galleryStatus: Presence;
  galleryHeadquarters: boolean;
  galleryTaskForce: boolean;
  galleryFeint: boolean;
  galleryReinforced: string;
  openGroups: Record<string, boolean>;
  menu: SymbolMenu | null;
  clipboard: Graphic | null;
};

export type SymbolMenu = {
  x: number;
  y: number;
  lng: number;
  lat: number;
  id: string | null;
};

type Action =
  | { type: "hydrate"; state: Partial<MapState> }
  | { type: "toggle-left"; panel: Exclude<LeftPanel, null> }
  | { type: "toggle-right"; panel: Exclude<RightPanel, null> }
  | { type: "close-panels" }
  | { type: "select"; id: string | null }
  | { type: "place-symbol"; symbol: CatalogSymbol }
  | { type: "place-generic"; kind: Extract<Placing, { mode: "generic" }>["kind"]; name: string }
  | { type: "cancel-place" }
  | { type: "map-click"; lng: number; lat: number }
  | { type: "finish-draft" }
  | { type: "move"; id: string; coordinates: [number, number][]; history?: boolean }
  | { type: "commit-move"; id: string; from: [number, number][]; to: [number, number][] }
  | { type: "scale"; id: string; scale: number; history?: boolean; from?: number }
  | { type: "rotate"; id: string; rotation: number; history?: boolean; from?: number }
  | { type: "menu"; menu: SymbolMenu | null }
  | { type: "copy"; id: string }
  | { type: "paste"; lng: number; lat: number }
  | { type: "patch"; id: string; patch: Partial<Graphic> }
  | { type: "modifiers"; id: string; modifiers: Partial<Modifiers> }
  | { type: "remove"; id: string }
  | { type: "duplicate"; id: string }
  | { type: "add-layer" }
  | { type: "rename-layer"; id: string; name: string }
  | { type: "patch-layer"; id: string; patch: Partial<MapLayer> }
  | { type: "activate-layer"; id: string }
  | { type: "delete-layer"; id: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "options"; patch: Partial<ViewOptions> }
  | { type: "toggle-favorite"; id: string }
  | { type: "info"; open: boolean }
  | { type: "cursor"; lngLat: [number, number] | null }
  | { type: "query"; query: string }
  | { type: "section"; section: SectionId }
  | {
      type: "gallery-style";
      patch: Partial<
        Pick<
          MapState,
          | "galleryAffiliation"
          | "galleryEchelon"
          | "galleryStatus"
          | "galleryHeadquarters"
          | "galleryTaskForce"
          | "galleryFeint"
          | "galleryReinforced"
        >
      >;
    }
  | { type: "toggle-group"; key: string }
  | { type: "clear-measure" }
  | { type: "import-graphics"; graphics: Graphic[] };

function snapshot(state: MapState): Snapshot {
  return {
    layers: state.layers,
    graphics: state.graphics,
    activeLayerId: state.activeLayerId,
  };
}

function withHistory(prev: MapState, next: MapState): MapState {
  return {
    ...next,
    past: [...prev.past, snapshot(prev)].slice(-80),
    future: [],
  };
}

function uid() {
  return crypto.randomUUID();
}

const starterLayer: MapLayer = {
  id: "layer-new",
  name: "New Layer",
  visible: true,
  locked: false,
};

export const initialState: MapState = {
  layers: [starterLayer],
  graphics: [],
  activeLayerId: starterLayer.id,
  selectedId: null,
  left: null,
  right: null,
  placing: null,
  draft: [],
  measurePts: [],
  options: DEFAULT_OPTIONS,
  favorites: [],
  past: [],
  future: [],
  infoOpen: false,
  cursor: null,
  query: "",
  gallerySection: "formations",
  galleryAffiliation: "F",
  galleryEchelon: "15",
  galleryStatus: "P",
  galleryHeadquarters: false,
  galleryTaskForce: false,
  galleryFeint: false,
  galleryReinforced: "",
  openGroups: { "formations:Movement and Maneuver": true, "formations:Movement and Maneuver:Infantry": true },
  menu: null,
  clipboard: null,
};

function restoreGraphic(graphic: Graphic, standard: ViewOptions["standard"]): Graphic {
  const raw = graphic.modifiers || EMPTY_MODIFIERS;
  const hadDistance = Object.prototype.hasOwnProperty.call(raw, "distance");
  const hadAzimuth = Object.prototype.hasOwnProperty.call(raw, "azimuth");
  const contract = graphic.renderer === "symbol" && graphic.basicId ? symbolContract(graphic.basicId, standard) : null;
  return {
    ...graphic,
    feint: Boolean(graphic.feint),
    modifiers: {
      ...EMPTY_MODIFIERS,
      ...raw,
      distance: hadDistance ? raw.distance : contract?.distance || "",
      azimuth: hadAzimuth ? raw.azimuth : contract?.azimuth || "",
    },
  };
}

function activeUnlocked(state: MapState) {
  const layer = state.layers.find((item) => item.id === state.activeLayerId);
  return Boolean(layer && !layer.locked);
}

function makeGraphic(state: MapState, coordinates: [number, number][]): Graphic {
  const placing = state.placing;
  const id = uid();
  if (placing && placing.mode === "symbol") {
    const symbol = placing.symbol;
    return {
      id,
      layerId: state.activeLayerId,
      name: symbol.name,
      renderer: "symbol",
      kind: symbol.kind,
      basicId: symbol.basicId,
      affiliation: state.galleryAffiliation,
      status: state.galleryStatus,
      echelon: state.galleryEchelon,
      headquarters: state.galleryHeadquarters,
      taskForce: state.galleryTaskForce,
      feint: state.galleryFeint,
      color: affiliationColor(state.galleryAffiliation),
      scale: 1,
      rotation: 0,
      coordinates,
      modifiers: defaultModifiers(symbol.basicId, state.options.standard, state.galleryReinforced),
    };
  }
  const kind = placing && placing.mode === "generic" ? placing.kind : "pin";
  const name = placing && placing.mode === "generic" ? placing.name : "Mark";
  const bean = kind === "bean";
  return {
    id,
    layerId: state.activeLayerId,
    name,
    renderer: "generic",
    kind,
    basicId: "",
    affiliation: bean ? state.galleryAffiliation : "F",
    status: "P",
    echelon: bean ? state.galleryEchelon : "00",
    headquarters: false,
    taskForce: false,
    feint: false,
    color: bean ? frameColor(state.galleryAffiliation) : "#1565c0",
    coordinates,
    modifiers: {
      ...EMPTY_MODIFIERS,
      uniqueDesignation: kind === "text" ? "Text" : "",
    },
  };
}

function commit(state: MapState, coordinates: [number, number][]): MapState {
  const graphic = makeGraphic(state, coordinates);
  return withHistory(state, {
    ...state,
    graphics: [...state.graphics, graphic],
    selectedId: graphic.id,
    draft: [],
  });
}

function reducer(state: MapState, action: Action): MapState {
  switch (action.type) {
    case "hydrate":
      return { ...state, ...action.state, past: [], future: [] };
    case "toggle-left":
      return { ...state, left: state.left === action.panel ? null : action.panel, infoOpen: false };
    case "toggle-right":
      return { ...state, right: state.right === action.panel ? null : action.panel, infoOpen: false };
    case "close-panels":
      return { ...state, left: null, right: null, infoOpen: false };
    case "select":
      return {
        ...state,
        selectedId: action.id,
        menu: null,
        right: action.id && !state.right ? "editor" : state.right,
      };
    case "place-symbol":
      return { ...state, placing: { mode: "symbol", symbol: action.symbol }, draft: [], right: "gallery" };
    case "place-generic":
      return {
        ...state,
        placing: { mode: "generic", kind: action.kind, name: action.name },
        draft: [],
        right: "gallery",
      };
    case "cancel-place":
      return { ...state, placing: null, draft: [] };
    case "map-click": {
      if (state.options.measure) {
        return { ...state, measurePts: [...state.measurePts, [action.lng, action.lat]] };
      }
      if (!state.placing) return { ...state, selectedId: null, menu: null };
      if (!activeUnlocked(state)) return state;
      const point: [number, number] = [action.lng, action.lat];
      if (state.placing.mode === "symbol") {
        const contract = symbolContract(state.placing.symbol.basicId, state.options.standard);
        if (contract.mode === "point") return commit(state, [point]);
        const next = [...state.draft, point];
        if (contract.maxPoints != null && next.length >= contract.maxPoints) return commit(state, next);
        if (contract.mode === "fixed" && next.length >= contract.minPoints) return commit(state, next);
        return { ...state, draft: next };
      }
      const kind = state.placing.kind;
      if (kind === "pin" || kind === "text") return commit(state, [point]);
      if ((kind === "rect" || kind === "circle" || kind === "bean") && state.draft.length >= 1) {
        return commit(state, [state.draft[0], point]);
      }
      return { ...state, draft: [...state.draft, point] };
    }
    case "finish-draft": {
      if (!state.placing || !activeUnlocked(state)) return { ...state, draft: [] };
      let pts = state.draft;
      if (pts.length >= 2) {
        const a = pts[pts.length - 1];
        const b = pts[pts.length - 2];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-8) pts = pts.slice(0, -1);
      }
      if (state.placing.mode === "symbol") {
        const contract = symbolContract(state.placing.symbol.basicId, state.options.standard);
        if (pts.length < contract.minPoints) return state;
        return commit(state, pts);
      }
      const min = state.placing.kind === "area" ? 3 : 2;
      if (pts.length < min) return { ...state, draft: [] };
      return commit(state, pts);
    }
    case "move": {
      const next = {
        ...state,
        graphics: state.graphics.map((graphic) =>
          graphic.id === action.id ? { ...graphic, coordinates: action.coordinates } : graphic,
        ),
      };
      return action.history === false ? next : withHistory(state, next);
    }
    case "commit-move": {
      const same =
        action.from.length === action.to.length &&
        action.from.every((point, index) => point[0] === action.to[index][0] && point[1] === action.to[index][1]);
      if (same || !state.graphics.some((graphic) => graphic.id === action.id)) return state;
      const placed = (coordinates: [number, number][]) => ({
        ...state,
        graphics: state.graphics.map((graphic) => (graphic.id === action.id ? { ...graphic, coordinates } : graphic)),
      });
      return withHistory(placed(action.from), placed(action.to));
    }
    case "scale": {
      const scale = Math.min(4, Math.max(0.25, action.scale));
      const placed = (value: number) => ({
        ...state,
        graphics: state.graphics.map((graphic) => (graphic.id === action.id ? { ...graphic, scale: value } : graphic)),
      });
      const next = placed(scale);
      if (action.history === false || action.from == null || Math.abs(action.from - scale) < 1e-6) return next;
      return withHistory(placed(action.from), next);
    }
    case "rotate": {
      const rotation = ((((action.rotation + 180) % 360) + 360) % 360) - 180;
      const placed = (value: number) => ({
        ...state,
        graphics: state.graphics.map((graphic) => (graphic.id === action.id ? { ...graphic, rotation: value } : graphic)),
      });
      const next = placed(rotation);
      if (action.history === false || action.from == null || Math.abs(action.from - rotation) < 0.05) return next;
      return withHistory(placed(action.from), next);
    }
    case "menu":
      return {
        ...state,
        menu: action.menu,
        selectedId: action.menu?.id ? action.menu.id : state.selectedId,
      };
    case "copy": {
      const source = state.graphics.find((graphic) => graphic.id === action.id);
      if (!source) return { ...state, menu: null };
      return {
        ...state,
        menu: null,
        clipboard: {
          ...source,
          modifiers: { ...source.modifiers },
          coordinates: source.coordinates.map((point) => [point[0], point[1]]),
        },
      };
    }
    case "paste": {
      const source = state.clipboard;
      if (!source || !activeUnlocked(state)) return { ...state, menu: null };
      const origin = centroid(source.coordinates);
      const copy: Graphic = {
        ...source,
        id: uid(),
        layerId: state.activeLayerId,
        modifiers: { ...source.modifiers },
        coordinates: source.coordinates.map(([lng, lat]) => [lng + action.lng - origin[0], lat + action.lat - origin[1]]),
      };
      return withHistory(state, {
        ...state,
        graphics: [...state.graphics, copy],
        selectedId: copy.id,
        menu: null,
      });
    }
    case "patch": {
      const patch = action.patch;
      return {
        ...state,
        graphics: state.graphics.map((graphic) => {
          if (graphic.id !== action.id) return graphic;
          const next = { ...graphic, ...patch };
          if (patch.affiliation && graphic.renderer === "symbol") next.color = affiliationColor(patch.affiliation);
          if (patch.affiliation && graphic.kind === "bean") next.color = frameColor(patch.affiliation);
          return next;
        }),
      };
    }
    case "modifiers":
      return {
        ...state,
        graphics: state.graphics.map((graphic) =>
          graphic.id === action.id
            ? { ...graphic, modifiers: { ...graphic.modifiers, ...action.modifiers } }
            : graphic,
        ),
      };
    case "remove":
      return withHistory(state, {
        ...state,
        graphics: state.graphics.filter((graphic) => graphic.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        menu: state.menu?.id === action.id ? null : state.menu,
      });
    case "duplicate": {
      const source = state.graphics.find((graphic) => graphic.id === action.id);
      if (!source) return state;
      const copy: Graphic = {
        ...source,
        id: uid(),
        modifiers: { ...source.modifiers },
        coordinates: source.coordinates.map(([lng, lat]) => [lng + 0.15, lat + 0.08]),
      };
      return withHistory(state, {
        ...state,
        graphics: [...state.graphics, copy],
        selectedId: copy.id,
      });
    }
    case "add-layer": {
      const layer: MapLayer = { id: uid(), name: "New Layer", visible: true, locked: false };
      return withHistory(state, {
        ...state,
        layers: [...state.layers, layer],
        activeLayerId: layer.id,
      });
    }
    case "rename-layer":
      return withHistory(state, {
        ...state,
        layers: state.layers.map((layer) =>
          layer.id === action.id ? { ...layer, name: action.name } : layer,
        ),
      });
    case "patch-layer":
      return withHistory(state, {
        ...state,
        layers: state.layers.map((layer) =>
          layer.id === action.id ? { ...layer, ...action.patch } : layer,
        ),
      });
    case "activate-layer":
      return { ...state, activeLayerId: action.id };
    case "delete-layer": {
      if (state.layers.length <= 1) return state;
      const layers = state.layers.filter((layer) => layer.id !== action.id);
      return withHistory(state, {
        ...state,
        layers,
        graphics: state.graphics.filter((graphic) => graphic.layerId !== action.id),
        activeLayerId: state.activeLayerId === action.id ? layers[0].id : state.activeLayerId,
        selectedId: state.graphics.find((g) => g.id === state.selectedId)?.layerId === action.id
          ? null
          : state.selectedId,
      });
    }
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...state,
        ...prev,
        past: state.past.slice(0, -1),
        future: [snapshot(state), ...state.future].slice(0, 80),
        selectedId: prev.graphics.some((g) => g.id === state.selectedId) ? state.selectedId : null,
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        ...next,
        past: [...state.past, snapshot(state)].slice(-80),
        future: state.future.slice(1),
        selectedId: next.graphics.some((g) => g.id === state.selectedId) ? state.selectedId : null,
      };
    }
    case "options": {
      const options = { ...state.options, ...action.patch };
      return {
        ...state,
        options,
        measurePts: action.patch.measure === false ? [] : state.measurePts,
      };
    }
    case "toggle-favorite": {
      const favorites = state.favorites.includes(action.id)
        ? state.favorites.filter((id) => id !== action.id)
        : [...state.favorites, action.id];
      return { ...state, favorites };
    }
    case "info":
      return { ...state, infoOpen: action.open, left: action.open ? null : state.left, right: action.open ? null : state.right };
    case "cursor":
      return { ...state, cursor: action.lngLat };
    case "query":
      return { ...state, query: action.query };
    case "section":
      return { ...state, gallerySection: action.section, query: action.section === "favorites" ? state.query : state.query };
    case "gallery-style":
      return { ...state, ...action.patch };
    case "toggle-group":
      return {
        ...state,
        openGroups: { ...state.openGroups, [action.key]: !state.openGroups[action.key] },
      };
    case "clear-measure":
      return { ...state, measurePts: [] };
    case "import-graphics":
      return withHistory(state, {
        ...state,
        graphics: [...state.graphics, ...action.graphics],
      });
    default:
      return state;
  }
}

const MapStoreContext = createContext<{ state: MapState; dispatch: Dispatch<Action> } | null>(null);

export function MapStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<MapState>;
        dispatch({
          type: "hydrate",
          state: {
            layers: saved.layers?.length ? saved.layers : initialState.layers,
            graphics: (saved.graphics || []).map((graphic) => restoreGraphic(graphic, saved.options?.standard || "2525")),
            activeLayerId: saved.activeLayerId || initialState.activeLayerId,
            options: { ...DEFAULT_OPTIONS, ...(saved.options || {}) },
            favorites: saved.favorites || [],
          },
        });
      }
    } catch {
      /* ignore broken local saves */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const payload = {
      layers: state.layers,
      graphics: state.graphics,
      activeLayerId: state.activeLayerId,
      options: state.options,
      favorites: state.favorites,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* quota */
    }
  }, [ready, state.layers, state.graphics, state.activeLayerId, state.options, state.favorites]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <MapStoreContext.Provider value={value}>{children}</MapStoreContext.Provider>;
}

export function useMapStore() {
  const ctx = useContext(MapStoreContext);
  if (!ctx) throw new Error("useMapStore must be used inside MapStoreProvider");
  return ctx;
}

export { AFFILIATIONS };
