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
import { affiliationColor } from "./symbols";
import {
  AFFILIATIONS,
  DEFAULT_OPTIONS,
  EMPTY_MODIFIERS,
  type CatalogSymbol,
  type Graphic,
  type LeftPanel,
  type MapLayer,
  type Modifiers,
  type Placing,
  type RightPanel,
  type SectionId,
  type ViewOptions,
} from "./types";

const STORAGE_KEY = "military-map-v1";

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
  openGroups: Record<string, boolean>;
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
  | { type: "move"; id: string; coordinates: [number, number][] }
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
  openGroups: { "formations:Combat:Infantry": true, "formations:Combat": true },
};

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
      codingscheme: symbol.codingscheme,
      battledimension: symbol.battledimension,
      functionid: symbol.functionid,
      affiliation: "F",
      status: "P",
      echelon: "-",
      headquarters: false,
      taskForce: false,
      color: affiliationColor("F"),
      coordinates,
      modifiers: { ...EMPTY_MODIFIERS },
    };
  }
  const kind = placing && placing.mode === "generic" ? placing.kind : "pin";
  const name = placing && placing.mode === "generic" ? placing.name : "Mark";
  return {
    id,
    layerId: state.activeLayerId,
    name,
    renderer: "generic",
    kind,
    codingscheme: "S",
    battledimension: "G",
    functionid: "------",
    affiliation: "F",
    status: "P",
    echelon: "-",
    headquarters: false,
    taskForce: false,
    color: "#1565c0",
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
      if (!state.placing) return { ...state, selectedId: null };
      if (!activeUnlocked(state)) return state;
      const point: [number, number] = [action.lng, action.lat];
      const kind = state.placing.mode === "symbol" ? state.placing.symbol.kind : state.placing.kind;
      if (kind === "point" || kind === "pin" || kind === "text") return commit(state, [point]);
      if ((kind === "rect" || kind === "circle") && state.draft.length >= 1) {
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
      const kind = state.placing.mode === "symbol" ? state.placing.symbol.kind : state.placing.kind;
      const min = kind === "area" ? 3 : 2;
      if (pts.length < min) return { ...state, draft: [] };
      return commit(state, pts);
    }
    case "move":
      return withHistory(state, {
        ...state,
        graphics: state.graphics.map((graphic) =>
          graphic.id === action.id ? { ...graphic, coordinates: action.coordinates } : graphic,
        ),
      });
    case "patch": {
      const patch = action.patch;
      return {
        ...state,
        graphics: state.graphics.map((graphic) => {
          if (graphic.id !== action.id) return graphic;
          const next = { ...graphic, ...patch };
          if (patch.affiliation && graphic.renderer === "symbol") next.color = affiliationColor(patch.affiliation);
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
            graphics: saved.graphics || [],
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
