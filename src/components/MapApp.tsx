"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Map } from "maplibre-gl";
import { formatBearing, formatLatLng, parseCoordinate, bearingDeg } from "@/lib/geo";
import { symbolContract } from "@/lib/symbols";
import { MapStoreProvider, useMapStore } from "@/lib/store";
import type { GroundCondition, MovementClass } from "@/lib/mcoo/classify";
import { AccountBar } from "./AccountBar";
import { MapCanvas } from "./MapCanvas";
import { McooPanel } from "./McooPanel";
import {
  ActiveLayerPanel,
  EditorPanel,
  GalleryPanel,
  LayersPanel,
  MeasureReadout,
  MessageCenter,
  OptionsPanel,
  PointListPanel,
  PrintPanel,
  SymbolAdjust,
  SymbolMenu,
} from "./panels";

export function MapApp() {
  return (
    <MapStoreProvider>
      <Shell />
    </MapStoreProvider>
  );
}

function Shell() {
  const { state, dispatch } = useMapStore();
  const mapRef = useRef<Map | null>(null);
  const [pitched, setPitched] = useState(false);
  const [search, setSearch] = useState("");
  const [searchError, setSearchError] = useState("");
  const [mcooOn, setMcooOn] = useState(false);
  const [mcooMovement, setMcooMovement] = useState<MovementClass>("tracked");
  const [mcooGround, setMcooGround] = useState<GroundCondition>("dry");
  const mcoo = useMemo(
    () => (mcooOn ? { movement: mcooMovement, ground: mcooGround } : null),
    [mcooOn, mcooMovement, mcooGround],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        dispatch({ type: "redo" });
      } else if (event.key === "Escape") {
        if (state.menu) dispatch({ type: "menu", menu: null });
        dispatch({ type: "cancel-place" });
        dispatch({ type: "clear-measure" });
      } else if (event.key === "Enter" && !typing) {
        dispatch({ type: "finish-draft" });
      } else if ((event.key === "Delete" || event.key === "Backspace") && !typing && state.selectedId) {
        dispatch({ type: "remove", id: state.selectedId });
      } else if (event.key === "F11") {
        event.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, state.menu, state.selectedId]);

  const hint = placementHint(
    state.placing,
    state.options.measure,
    state.layers.find((l) => l.id === state.activeLayerId)?.locked,
    state.galleryAffiliation,
    state.draft.length,
    state.options.standard,
  );

  return (
    <div className={`app${state.options.theme === "dark" ? " dark" : ""}`}>
      <MapCanvas mapRef={mapRef} mcoo={mcoo} />
      <div className="rail rail-left">
        <Tool title="Layers" active={state.left === "layers"} onClick={() => dispatch({ type: "toggle-left", panel: "layers" })}>
          <LayersIcon />
        </Tool>
        <Tool title="Active/Selected Layer" active={state.left === "active"} onClick={() => dispatch({ type: "toggle-left", panel: "active" })}>
          <LayerIcon />
        </Tool>
        <Tool title="Print map or Export to PDF" active={state.left === "print"} onClick={() => dispatch({ type: "toggle-left", panel: "print" })}>
          <PrintIcon />
        </Tool>
        <Tool title="Options" active={state.left === "options"} onClick={() => dispatch({ type: "toggle-left", panel: "options" })}>
          <SlidersIcon />
        </Tool>
        <Tool className="mcoo-tool" title="Combined obstacle overlay" active={mcooOn} onClick={() => setMcooOn((on) => !on)}>
          MCOO
        </Tool>
      </div>
      <div className="rail rail-right">
        <Tool title="Add new symbol" active={state.right === "gallery"} onClick={() => dispatch({ type: "toggle-right", panel: "gallery" })}>
          <PlusIcon />
        </Tool>
        <Tool
          title="Symbol Editor"
          active={state.right === "editor"}
          disabled={!state.selectedId}
          onClick={() => dispatch({ type: "toggle-right", panel: "editor" })}
        >
          <EditorIcon />
        </Tool>
        <Tool
          title="View and edit graphic's coordinates"
          active={state.right === "points"}
          disabled={!state.selectedId}
          onClick={() => dispatch({ type: "toggle-right", panel: "points" })}
        >
          <ListIcon />
        </Tool>
      </div>
      <div className="rail rail-corner">
        <Tool title="Undo (Ctrl + Z)" disabled={!state.past.length} onClick={() => dispatch({ type: "undo" })}>
          <UndoIcon />
        </Tool>
        <Tool title="Redo (Ctrl + Y)" disabled={!state.future.length} onClick={() => dispatch({ type: "redo" })}>
          <RedoIcon />
        </Tool>
        <Tool
          title="3D"
          active={pitched}
          onClick={() => {
            const map = mapRef.current;
            if (!map) return;
            const next = !pitched;
            setPitched(next);
            if (next) {
              map.easeTo({ pitch: 62, bearing: -18, duration: 700 });
              try {
                if (!map.getSource("terrain-dem")) {
                  map.addSource("terrain-dem", {
                    type: "raster-dem",
                    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
                    encoding: "terrarium",
                    tileSize: 256,
                    maxzoom: 15,
                  });
                }
                map.setTerrain({ source: "terrain-dem", exaggeration: 1.25 });
              } catch {
                /* terrain is optional */
              }
            } else {
              map.setTerrain(null);
              map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
            }
          }}
        >
          3D
        </Tool>
        <div className="corner-row">
          <Tool title="Message & Info Center" active={state.infoOpen} onClick={() => dispatch({ type: "info", open: !state.infoOpen })}>
            i
          </Tool>
          <Tool title="Full screen [F11]" onClick={toggleFullscreen}>
            <ExpandIcon />
          </Tool>
        </div>
      </div>

      {state.left === "layers" && <LayersPanel />}
      {state.left === "active" && <ActiveLayerPanel />}
      {state.left === "print" && <PrintPanel mapRef={mapRef} />}
      {state.left === "options" && <OptionsPanel />}
      {mcooOn && (
        <McooPanel
          movement={mcooMovement}
          ground={mcooGround}
          onMovement={setMcooMovement}
          onGround={setMcooGround}
          onClose={() => setMcooOn(false)}
        />
      )}
      {state.right === "gallery" && <GalleryPanel />}
      {state.right === "editor" && <EditorPanel />}
      {state.right === "points" && <PointListPanel />}
      {state.infoOpen && <MessageCenter />}

      {state.options.hints && hint && <div className="hint">{hint}</div>}
      {state.selectedId && (
        <SymbolAdjust graphic={state.graphics.find((item) => item.id === state.selectedId)} floating />
      )}
      <SymbolMenu />
      {state.options.coordinateSearch && (
        <form
          className="coord-search"
          onSubmit={(event) => {
            event.preventDefault();
            const point = parseCoordinate(search);
            if (!point) {
              setSearchError("Use lat, lon or an MGRS grid.");
              return;
            }
            setSearchError("");
            mapRef.current?.flyTo({ center: point, zoom: Math.max(mapRef.current.getZoom(), 11) });
          }}
        >
          <input
            value={search}
            placeholder="lat, lon or MGRS"
            aria-label="Coordinate search"
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="submit">Go</button>
          {searchError && <span>{searchError}</span>}
        </form>
      )}
      {state.options.cursorCoordinate && state.cursor && (
        <div className="coord-readout">
          {formatLatLng(state.cursor[0], state.cursor[1], state.options.geoFormat)}
          {state.measurePts.length >= 1 && state.options.measure
            ? ` · ${formatBearing(bearingDeg(state.measurePts[state.measurePts.length - 1], state.cursor), state.options.angularUnit)}`
            : ""}
        </div>
      )}
      <MeasureReadout />
      <AccountBar />
    </div>
  );
}

function placementHint(
  placing: ReturnType<typeof useMapStore>["state"]["placing"],
  measure: boolean,
  locked?: boolean,
  affiliation?: ReturnType<typeof useMapStore>["state"]["galleryAffiliation"],
  draftLength = 0,
  standard: ReturnType<typeof useMapStore>["state"]["options"]["standard"] = "2525",
) {
  if (measure) return "Measure: click the map to add points. Esc clears the measurement.";
  if (!placing) return null;
  if (locked) return "The active layer is locked. Unlock it in Layers before drawing.";
  const kind = placing.mode === "symbol" ? placing.symbol.kind : placing.kind;
  const name = placing.mode === "symbol" ? placing.symbol.name : placing.name;
  const side = placing.mode === "symbol" ? (affiliation === "H" ? "enemy " : affiliation === "N" ? "neutral " : affiliation === "U" ? "unknown " : "") : "";
  if (placing.mode === "symbol") {
    const contract = symbolContract(placing.symbol.basicId, standard);
    const title = `${side}${name}`;
    if (contract.mode === "point") return `Click the map to place ${title}. Esc cancels.`;
    if (contract.mode === "fixed") {
      const total = contract.maxPoints ?? contract.minPoints;
      const step = Math.min(draftLength + 1, total);
      return `${title}. Point ${step} of ${total}.`;
    }
    if (draftLength < contract.minPoints) {
      const left = contract.minPoints - draftLength;
      return `${title}. At least ${contract.minPoints} points. ${left} more needed.`;
    }
    return `${title}. At least ${contract.minPoints} points. Double-click or Enter to finish.`;
  }
  if (kind === "point" || kind === "pin" || kind === "text") return `Click the map to place ${side}${name}. Esc cancels.`;
  if (kind === "rect") return "Click one corner, then the opposite corner.";
  if (kind === "circle") return "Click the center, then a point on the edge.";
  if (kind === "bean") return "Click the center, then the far end. Friend is blue, enemy is red. Unit size sets platoon or company.";
  if (kind === "area") return `Click to add vertices of ${name}. Double-click or Enter to close the area.`;
  return `Click to add vertices of ${name}. Double-click or Enter to finish the line.`;
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
}

function Tool({
  title,
  active,
  disabled,
  className,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={`tool${active ? " active" : ""}${className ? ` ${className}` : ""}`} title={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4 3 9l9 5 9-5-9-5Z" />
      <path d="m3 14 9 5 9-5" />
      <path d="m3 11 9 5 9-5" />
    </svg>
  );
}
function LayerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  );
}
function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 8V4h10v4" />
      <path d="M6 17H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M7 14h10v6H7z" />
    </svg>
  );
}
function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="8" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function EditorIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="12" rx="1" />
      <path d="M8 20h8M9 9h6M9 12h4" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7h12M8 12h12M8 17h12" />
      <circle cx="4.5" cy="7" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="17" r="1" />
    </svg>
  );
}
function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 8H4v4" />
      <path d="M4 12a8 8 0 1 0 2.3-5.7" />
    </svg>
  );
}
function RedoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 8h4v4" />
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
    </svg>
  );
}
function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </svg>
  );
}
