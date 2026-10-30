"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, Info, Layers, List, ListTree, Maximize2, Plus, Printer, Redo2, SlidersHorizontal, SquarePen, Undo2 } from "lucide-react";
import type { Map } from "maplibre-gl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatBearing, formatLatLng, parseCoordinate, bearingDeg } from "@/lib/geo";
import { symbolContract } from "@/lib/symbols";
import { MapStoreProvider, useMapStore } from "@/lib/store";
import { AccountBar } from "./AccountBar";
import { CommandPalette } from "./CommandPalette";
import { MapCanvas } from "./MapCanvas";
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
  const [palette, setPalette] = useState(false);
  const mcoo = useMemo(
    () =>
      state.options.mcoo
        ? {
            movement: state.options.mcooMovement,
            ground: state.options.mcooGround,
            opacity: state.options.mcooOpacity,
          }
        : null,
    [state.options.mcoo, state.options.mcooGround, state.options.mcooMovement, state.options.mcooOpacity],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        dispatch({ type: "redo" });
      } else if (event.key === "Escape") {
        if (palette) {
          setPalette(false);
          return;
        }
        if (state.menu) dispatch({ type: "menu", menu: null });
        dispatch({ type: "cancel-place" });
        dispatch({ type: "clear-measure" });
      } else if (event.key === "Enter" && !typing) {
        dispatch({ type: "finish-draft" });
      } else if ((event.key === "Delete" || event.key === "Backspace") && !typing) {
        const ids = state.selectedIds.length ? state.selectedIds : state.selectedId ? [state.selectedId] : [];
        if (ids.length) dispatch({ type: "remove", ids });
      } else if (event.key === "F11") {
        event.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, palette, state.menu, state.selectedId, state.selectedIds]);

  useEffect(() => {
    if (!state.toast) return;
    const timer = window.setTimeout(() => dispatch({ type: "dismiss-toast" }), 5000);
    return () => window.clearTimeout(timer);
  }, [dispatch, state.toast]);

  const hint = placementHint(
    state.placing,
    state.options.measure,
    state.layers.find((l) => l.id === state.activeLayerId)?.locked,
    state.galleryAffiliation,
    state.draft.length,
    state.options.standard,
  );

  const leftCover = state.left !== null;

  return (
    <TooltipProvider>
    <div
      className={`app${state.options.theme === "light" ? "" : " dark"}${state.options.theme === "night" ? " night" : ""}${state.options.showScale ? " show-scale" : ""}${leftCover ? " left-open" : ""}${state.right ? " right-open" : ""}`}
    >
      <MapCanvas mapRef={mapRef} mcoo={mcoo} />
      <div className="rail rail-left">
        <Tool primary title="Add new symbol" active={state.right === "gallery"} onClick={() => dispatch({ type: "toggle-right", panel: "gallery" })}>
          <Plus />
        </Tool>
        <Tool title="Layers" active={state.left === "layers"} onClick={() => dispatch({ type: "toggle-left", panel: "layers" })}>
          <Layers />
        </Tool>
        <Tool title="Active/Selected Layer" active={state.left === "active"} onClick={() => dispatch({ type: "toggle-left", panel: "active" })}>
          <ListTree />
        </Tool>
        <Tool
          title="Symbol Editor"
          active={state.right === "editor"}
          disabled={!state.selectedId}
          onClick={() => dispatch({ type: "toggle-right", panel: "editor" })}
        >
          <SquarePen />
        </Tool>
        <Tool
          title="View and edit graphic's coordinates"
          active={state.right === "points"}
          disabled={!state.selectedId}
          onClick={() => dispatch({ type: "toggle-right", panel: "points" })}
        >
          <List />
        </Tool>
        <div className="rail-spacer" />
        <Tool title="Print map or Export to PDF" active={state.left === "print"} onClick={() => dispatch({ type: "toggle-left", panel: "print" })}>
          <Printer />
        </Tool>
        <Tool title="Settings" active={state.left === "options"} onClick={() => dispatch({ type: "toggle-left", panel: "options" })}>
          <SlidersHorizontal />
        </Tool>
        <Tool title="Undo (Ctrl+Z)" disabled={!state.past.length} onClick={() => dispatch({ type: "undo" })}>
          <Undo2 />
        </Tool>
        <Tool title="Redo (Ctrl+Shift+Z)" disabled={!state.future.length} onClick={() => dispatch({ type: "redo" })}>
          <Redo2 />
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
          <Box />
        </Tool>
        <Tool title="Message & Info Center" active={state.infoOpen} onClick={() => dispatch({ type: "info", open: !state.infoOpen })}>
          <Info />
        </Tool>
        <Tool title="Full screen [F11]" onClick={toggleFullscreen}>
          <Maximize2 />
        </Tool>
      </div>

      <div className="left-stack">
        {state.left === "layers" && <LayersPanel />}
        {state.left === "active" && <ActiveLayerPanel />}
        {state.left === "print" && <PrintPanel mapRef={mapRef} />}
        {state.left === "options" && <OptionsPanel />}
      </div>
      {state.right === "gallery" && <GalleryPanel />}
      {state.right === "editor" && <EditorPanel />}
      {state.right === "points" && <PointListPanel />}
      {state.infoOpen && <MessageCenter />}

      {hint && (
        <div className="placement-chip" role="status">
          <span>{state.options.hints ? hint : shortPlacementLabel(state.placing, state.options.measure, state.galleryAffiliation)}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              dispatch({ type: "cancel-place" });
              dispatch({ type: "clear-measure" });
            }}
          >
            Cancel
          </Button>
        </div>
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
          <Input
            value={search}
            placeholder="Search a coordinate"
            aria-label="Coordinate search"
            className="w-[240px] border-0 shadow-none focus-visible:ring-0"
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button type="submit" size="sm">Go</Button>
          {searchError && <span>{searchError}</span>}
        </form>
      )}
      <div className="map-dock">
        <div className="dock-coord">
          {state.options.cursorCoordinate && state.cursor && (
            <div className="coord-readout">
              {formatLatLng(state.cursor[0], state.cursor[1], state.options.geoFormat)}
              {state.measurePts.length >= 1 && state.options.measure
                ? ` · ${formatBearing(bearingDeg(state.measurePts[state.measurePts.length - 1], state.cursor), state.options.angularUnit)}`
                : ""}
            </div>
          )}
        </div>
        <div className="dock-center">
          {state.selectedId && (
            <SymbolAdjust graphic={state.graphics.find((item) => item.id === state.selectedId)} floating />
          )}
          <MeasureReadout />
        </div>
        <div className="dock-account">
          <AccountBar />
        </div>
      </div>
      <CommandPalette open={palette} mapRef={mapRef} onClose={() => setPalette(false)} />
      {state.toast && (
        <div className="toast" role="status">
          <span>{state.toast.text}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => dispatch({ type: "undo" })}>
            Undo
          </Button>
          <Button type="button" variant="ghost" size="sm" aria-label="Dismiss" onClick={() => dispatch({ type: "dismiss-toast" })}>
            ×
          </Button>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}

function shortPlacementLabel(
  placing: ReturnType<typeof useMapStore>["state"]["placing"],
  measure: boolean,
  affiliation?: ReturnType<typeof useMapStore>["state"]["galleryAffiliation"],
) {
  if (measure) return "Measure";
  if (!placing) return "Measure";
  const name = placing.mode === "symbol" ? placing.symbol.name : placing.name;
  const side = placing.mode === "symbol" ? (affiliation === "H" ? "Enemy " : affiliation === "N" ? "Neutral " : affiliation === "U" ? "Unknown " : "Friend ") : "";
  return `${side}${name}`.trim();
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
  primary,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  primary?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={primary ? "default" : "ghost"}
          size="icon"
          className={cn("[&_svg]:size-[18px]", active && !primary && "bg-secondary")}
          aria-label={title}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{title}</TooltipContent>
    </Tooltip>
  );
}
