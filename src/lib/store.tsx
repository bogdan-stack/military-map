"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";
import { useWorkspaceSync, type PersistenceControls } from "@/persistence/useWorkspaceSync";
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
  selectedIds: string[];
  toast: { text: string } | null;
  left: LeftPanel;
  right: RightPanel;
  placing: Placing | null;
  draft: [number, number][];
  measurePts: [number, number][];
  options: ViewOptions;
  favorites: string[];
  recent: string[];
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
  | { type: "select"; id: string | null; shift?: boolean }
  | { type: "place-symbol"; symbol: CatalogSymbol }
  | { type: "place-generic"; kind: Extract<Placing, { mode: "generic" }>["kind"]; name: string }
  | { type: "cancel-place" }
  | { type: "map-click"; lng: number; lat: number; shift?: boolean }
  | { type: "finish-draft" }
  | { type: "move"; id: string; coordinates: [number, number][]; history?: boolean }
  | { type: "commit-move"; id: string; from: [number, number][]; to: [number, number][] }
  | { type: "move-group"; items: { id: string; coordinates: [number, number][] }[]; history?: boolean }
  | { type: "commit-group"; items: { id: string; from: [number, number][]; to: [number, number][] }[] }
  | { type: "scale"; id: string; scale: number; history?: boolean; from?: number }
  | { type: "rotate"; id: string; rotation: number; history?: boolean; from?: number }
  | { type: "menu"; menu: SymbolMenu | null }
  | { type: "copy"; id: string }
  | { type: "paste"; lng: number; lat: number }
  | { type: "patch"; id: string; patch: Partial<Graphic>; history?: boolean; from?: Partial<Graphic> }
  | { type: "modifiers"; id: string; modifiers: Partial<Modifiers>; history?: boolean; from?: Partial<Modifiers> }
  | { type: "set-recent"; ids: string[] }
  | { type: "remove"; ids: string[] }
  | { type: "dismiss-toast" }
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

function applyGraphicPatch(state: MapState, id: string, patch: Partial<Graphic>): MapState {
  return {
    ...state,
    graphics: state.graphics.map((graphic) => {
      if (graphic.id !== id) return graphic;
      const next = { ...graphic, ...patch };
      if (patch.affiliation && graphic.renderer === "symbol") next.color = affiliationColor(patch.affiliation);
      if (patch.affiliation && graphic.kind === "bean") next.color = frameColor(patch.affiliation);
      return next;
    }),
  };
}

function applyModifiers(state: MapState, id: string, modifiers: Partial<Modifiers>): MapState {
  return {
    ...state,
    graphics: state.graphics.map((graphic) =>
      graphic.id === id ? { ...graphic, modifiers: { ...graphic.modifiers, ...modifiers } } : graphic,
    ),
  };
}

function sameFields(patch: object, current: object) {
  return Object.entries(patch).every(([key, value]) => (current as Record<string, unknown>)[key] === value);
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
  selectedIds: [],
  toast: null,
  left: null,
  right: null,
  placing: null,
  draft: [],
  measurePts: [],
  options: DEFAULT_OPTIONS,
  favorites: [],
  recent: [],
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
    selectedIds: [graphic.id],
    draft: [],
  });
}

function reducer(state: MapState, action: Action): MapState {
  switch (action.type) {
    case "hydrate": {
      const next = { ...state, ...action.state, past: [], future: [], toast: null };
      const graphics = next.graphics ?? [];
      let selectedIds = (next.selectedIds ?? []).filter((id) => graphics.some((graphic) => graphic.id === id));
      if (!selectedIds.length && next.selectedId && graphics.some((graphic) => graphic.id === next.selectedId)) {
        selectedIds = [next.selectedId];
      }
      const selectedId = selectedIds.includes(next.selectedId ?? "") ? next.selectedId : (selectedIds[0] ?? null);
      return { ...next, selectedIds, selectedId };
    }
    case "toggle-left":
      return { ...state, left: state.left === action.panel ? null : action.panel, infoOpen: false };
    case "toggle-right":
      return { ...state, right: state.right === action.panel ? null : action.panel, infoOpen: false };
    case "close-panels":
      return { ...state, left: null, right: null, infoOpen: false };
    case "select": {
      if (!action.id) return { ...state, selectedId: null, selectedIds: [], menu: null };
      if (action.shift) {
        const exists = state.selectedIds.includes(action.id);
        const selectedIds = exists ? state.selectedIds.filter((id) => id !== action.id) : [...new Set([...state.selectedIds, action.id])];
        return { ...state, selectedIds, selectedId: selectedIds[selectedIds.length - 1] ?? null, menu: null };
      }
      return { ...state, selectedId: action.id, selectedIds: [action.id], menu: null };
    }
    case "place-symbol": {
      const recent =
        state.recent[0] === action.symbol.id
          ? state.recent
          : [action.symbol.id, ...state.recent.filter((id) => id !== action.symbol.id)].slice(0, 8);
      return { ...state, placing: { mode: "symbol", symbol: action.symbol }, draft: [], right: "gallery", recent };
    }
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
      if (!state.placing) {
        if (action.shift) return state;
        return { ...state, selectedId: null, selectedIds: [], menu: null };
      }
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
        selectedIds: [copy.id],
        menu: null,
      });
    }
    case "patch": {
      if (action.history === false) return applyGraphicPatch(state, action.id, action.patch);
      if (action.from && sameFields(action.patch, action.from)) return state;
      const graphic = state.graphics.find((item) => item.id === action.id);
      if (!graphic) return state;
      if (!action.from && sameFields(action.patch, graphic)) return state;
      const before = action.from ? applyGraphicPatch(state, action.id, action.from) : state;
      return withHistory(before, applyGraphicPatch(state, action.id, action.patch));
    }
    case "modifiers": {
      if (action.history === false) return applyModifiers(state, action.id, action.modifiers);
      if (action.from && sameFields(action.modifiers, action.from)) return state;
      const graphic = state.graphics.find((item) => item.id === action.id);
      if (!graphic) return state;
      if (!action.from && sameFields(action.modifiers, graphic.modifiers)) return state;
      const before = action.from ? applyModifiers(state, action.id, action.from) : state;
      return withHistory(before, applyModifiers(state, action.id, action.modifiers));
    }
    case "set-recent":
      return { ...state, recent: action.ids.slice(0, 8) };
    case "remove": {
      const ids = new Set(action.ids);
      const doomed = state.graphics.filter((graphic) => ids.has(graphic.id));
      if (!doomed.length) return state;
      const label = doomed.length === 1 ? doomed[0].modifiers.uniqueDesignation || doomed[0].name : `${doomed.length} symbols`;
      const next = withHistory(state, {
        ...state,
        graphics: state.graphics.filter((graphic) => !ids.has(graphic.id)),
        selectedId: state.selectedId && ids.has(state.selectedId) ? null : state.selectedId,
        selectedIds: state.selectedIds.filter((id) => !ids.has(id)),
        menu: state.menu?.id && ids.has(state.menu.id) ? null : state.menu,
      });
      return { ...next, toast: { text: `Deleted ${label}` } };
    }
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
        selectedIds: [copy.id],
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
        selectedId: state.graphics.find((g) => g.id === state.selectedId)?.layerId === action.id ? null : state.selectedId,
        selectedIds: state.selectedIds.filter((id) => state.graphics.find((graphic) => graphic.id === id)?.layerId !== action.id),
      });
    }
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      const selectedIds = state.selectedIds.filter((id) => prev.graphics.some((graphic) => graphic.id === id));
      return {
        ...state,
        ...prev,
        past: state.past.slice(0, -1),
        future: [snapshot(state), ...state.future].slice(0, 80),
        selectedIds,
        selectedId: selectedIds.includes(state.selectedId ?? "") ? state.selectedId : selectedIds[0] ?? null,
        toast: null,
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      const selectedIds = state.selectedIds.filter((id) => next.graphics.some((graphic) => graphic.id === id));
      return {
        ...state,
        ...next,
        past: [...state.past, snapshot(state)].slice(-80),
        future: state.future.slice(1),
        selectedIds,
        selectedId: selectedIds.includes(state.selectedId ?? "") ? state.selectedId : selectedIds[0] ?? null,
        toast: null,
      };
    }
    case "dismiss-toast":
      return { ...state, toast: null };
    case "move-group": {
      const byId = new Map(action.items.map((item) => [item.id, item.coordinates]));
      const next = {
        ...state,
        graphics: state.graphics.map((graphic) => (byId.has(graphic.id) ? { ...graphic, coordinates: byId.get(graphic.id)! } : graphic)),
      };
      return action.history === false ? next : withHistory(state, next);
    }
    case "commit-group": {
      const changed = action.items.filter(
        (item) => item.from.length !== item.to.length || item.from.some((point, index) => point[0] !== item.to[index]?.[0] || point[1] !== item.to[index]?.[1]),
      );
      if (!changed.length) return state;
      const apply = (key: "from" | "to") => ({
        ...state,
        graphics: state.graphics.map((graphic) => {
          const item = changed.find((entry) => entry.id === graphic.id);
          return item ? { ...graphic, coordinates: item[key] } : graphic;
        }),
      });
      return withHistory(apply("from"), apply("to"));
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

const MapStoreContext = createContext<{
  state: MapState;
  dispatch: Dispatch<Action>;
  persistence: PersistenceControls;
} | null>(null);

const RECENT_KEY = "military-map-recent";

function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function MapStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const recentReady = useRef(false);
  const persistence = useWorkspaceSync(state, dispatch, restoreGraphic);
  useEffect(() => {
    const ids = readRecent();
    if (ids.length) dispatch({ type: "set-recent", ids });
    recentReady.current = true;
  }, [dispatch]);
  useEffect(() => {
    if (!recentReady.current) return;
    if (state.recent.length === 0 && readRecent().length > 0) return;
    localStorage.setItem(RECENT_KEY, JSON.stringify(state.recent));
  }, [state.recent]);
  const value = useMemo(() => ({ state, dispatch, persistence }), [state, dispatch, persistence]);
  return <MapStoreContext.Provider value={value}>{children}</MapStoreContext.Provider>;
}

export function useMapStore() {
  const ctx = useContext(MapStoreContext);
  if (!ctx) throw new Error("useMapStore must be used inside MapStoreProvider");
  return ctx;
}

export { AFFILIATIONS };
