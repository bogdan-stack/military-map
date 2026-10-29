"use client";

import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import type { Map } from "maplibre-gl";
import { getCatalog, groupCatalog } from "@/lib/catalog";
import { formatDistance, formatLatLng, parseCoordinate, pathLength, ringArea } from "@/lib/geo";
import { useMapStore } from "@/lib/store";
import { affiliationColor, FIELD, renderMeasurePreview, renderSymbol, symbolAllows, TEXT_MODIFIERS } from "@/lib/symbols";
import {
  AFFILIATIONS,
  ECHELONS,
  EMPTY_MODIFIERS,
  type Affiliation,
  type CatalogSymbol,
  type Graphic,
  type SectionId,
  type ViewOptions,
} from "@/lib/types";

function synthetic(
  symbol: CatalogSymbol,
  style: {
    affiliation: Affiliation;
    status: Graphic["status"];
    echelon: string;
    headquarters: boolean;
    taskForce: boolean;
    feint: boolean;
    reinforced: string;
  },
): Graphic {
  return {
    id: symbol.id,
    layerId: "",
    name: symbol.name,
    renderer: "symbol",
    kind: symbol.kind,
    basicId: symbol.basicId,
    affiliation: style.affiliation,
    status: style.status,
    echelon: style.echelon,
    headquarters: style.headquarters,
    taskForce: style.taskForce,
    feint: style.feint,
    color: affiliationColor(style.affiliation),
    coordinates: [],
    modifiers: { ...EMPTY_MODIFIERS, reinforcedReduced: style.reinforced },
  };
}

export function SymbolThumb({ symbol, size = 48 }: { symbol: CatalogSymbol; size?: number }) {
  const { state } = useMapStore();
  const style = {
    affiliation: state.galleryAffiliation,
    status: state.galleryStatus,
    echelon: state.galleryEchelon,
    headquarters: state.galleryHeadquarters,
    taskForce: state.galleryTaskForce,
    feint: state.galleryFeint,
    reinforced: state.galleryReinforced,
  };
  const svg = useMemo(() => {
    const graphic = synthetic(symbol, style);
    if (symbol.kind !== "point") return renderMeasurePreview(graphic, state.options) ?? "";
    return renderSymbol(graphic, state.options, size, false)?.svg ?? "";
  }, [size, state.options, style.affiliation, style.echelon, style.feint, style.headquarters, style.reinforced, style.status, style.taskForce, symbol]);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready || !svg) return <span className="thumb-svg" />;
  return <span className="thumb-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function GraphicThumb({ graphic }: { graphic: Graphic }) {
  const { state } = useMapStore();
  const svg = useMemo(() => {
    if (graphic.renderer !== "symbol") return "";
    if (graphic.kind !== "point") return renderMeasurePreview(graphic, state.options) ?? "";
    const drawn = renderSymbol(graphic, state.options, 64, false);
    return drawn?.svg ?? "";
  }, [graphic, state.options]);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready || !svg) {
    if (graphic.renderer === "symbol") return null;
    return (
      <span className="thumb-fallback" style={{ color: graphic.color }}>
        {graphic.name.slice(0, 3)}
      </span>
    );
  }
  return <span className="thumb-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
}

const SECTIONS: { id: SectionId; label: string; glyph: string }[] = [
  { id: "favorites", label: "My Favorites", glyph: "★" },
  { id: "formations", label: "Formations", glyph: "▣" },
  { id: "equipment", label: "Equipment and Installations", glyph: "⬡" },
  { id: "tactical", label: "Tactical Graphics", glyph: "⌖" },
  { id: "signals", label: "Signals Intelligence", glyph: "📡" },
  { id: "stability", label: "Stability Operations", glyph: "⚑" },
  { id: "emergency", label: "METOC", glyph: "✚" },
];

export function GalleryPanel() {
  const { state, dispatch } = useMapStore();
  const catalog = useMemo(() => getCatalog(), []);
  const placingId = state.placing?.mode === "symbol" ? state.placing.symbol.id : null;
  const query = state.query.trim().toLowerCase();
  const section = state.gallerySection;

  const symbols = useMemo(() => {
    if (query) return catalog.filter((symbol) => symbol.name.toLowerCase().includes(query)).slice(0, 120);
    if (section === "favorites") return catalog.filter((symbol) => state.favorites.includes(symbol.id));
    return catalog.filter((symbol) => symbol.section === section);
  }, [catalog, query, section, state.favorites]);

  const grouped = useMemo(() => (query ? null : groupCatalog(symbols)), [query, symbols]);

  return (
    <aside className="panel panel-right gallery">
      <div className="gallery-switch">
        <button type="button" className={!query ? "on" : ""} onClick={() => dispatch({ type: "query", query: "" })}>
          Symbol Gallery
        </button>
        <button type="button" className={query ? "on" : ""} onClick={() => dispatch({ type: "section", section: "formations" })}>
          MIL-STD Search
        </button>
        <button type="button" className="icon-x" onClick={() => dispatch({ type: "toggle-right", panel: "gallery" })} aria-label="Close">
          ×
        </button>
      </div>
      <div className="search-line">
        <input
          value={state.query}
          placeholder="Search MIL-STD-2525 symbols"
          onChange={(event) => dispatch({ type: "query", query: event.target.value })}
          aria-label="Symbol search"
        />
      </div>
      <div className="section-row">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={section === item.id && !query ? "on" : ""}
            title={item.label}
            onClick={() => {
              dispatch({ type: "query", query: "" });
              dispatch({ type: "section", section: item.id });
            }}
          >
            <span>{item.glyph}</span>
            <small>{item.label}</small>
          </button>
        ))}
      </div>
      <div className="side-row" role="group" aria-label="Standard identity">
        {AFFILIATIONS.map((item) => (
          <button
            key={item.code}
            type="button"
            className={state.galleryAffiliation === item.code ? "on" : ""}
            style={{ borderColor: affiliationColor(item.code), color: affiliationColor(item.code) }}
            onClick={() => dispatch({ type: "gallery-style", patch: { galleryAffiliation: item.code } })}
          >
            {item.code === "H" ? "Enemy" : item.label}
          </button>
        ))}
      </div>
      <div className="style-grid">
        <label>
          Unit size
          <select
            value={state.galleryEchelon}
            onChange={(event) => dispatch({ type: "gallery-style", patch: { galleryEchelon: event.target.value } })}
          >
            {ECHELONS.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={state.galleryStatus}
            onChange={(event) =>
              dispatch({ type: "gallery-style", patch: { galleryStatus: event.target.value as Graphic["status"] } })
            }
          >
            <option value="P">Present</option>
            <option value="A">Anticipated</option>
          </select>
        </label>
        <div className="style-checks">
          <label>
            <input
              type="checkbox"
              checked={state.galleryHeadquarters}
              onChange={(event) => dispatch({ type: "gallery-style", patch: { galleryHeadquarters: event.target.checked } })}
            />
            Headquarters
          </label>
          <label>
            <input
              type="checkbox"
              checked={state.galleryTaskForce}
              onChange={(event) => dispatch({ type: "gallery-style", patch: { galleryTaskForce: event.target.checked } })}
            />
            Task force
          </label>
          <label>
            <input
              type="checkbox"
              checked={state.galleryFeint}
              onChange={(event) => dispatch({ type: "gallery-style", patch: { galleryFeint: event.target.checked } })}
            />
            Feint / dummy
          </label>
          <label>
            Reinforced
            <select
              value={state.galleryReinforced}
              onChange={(event) => dispatch({ type: "gallery-style", patch: { galleryReinforced: event.target.value } })}
            >
              <option value="">None</option>
              <option value="+">Reinforced (+)</option>
              <option value="-">Reduced (−)</option>
              <option value="±">Reinforced and reduced (±)</option>
            </select>
          </label>
        </div>
      </div>
      <div className="generic-row">
        {(
          [
            ["pin", "Pin"],
            ["line", "Line"],
            ["area", "Area"],
            ["text", "Text"],
            ["rect", "Rectangle"],
            ["circle", "Circle"],
          ] as const
        ).map(([kind, name]) => (
          <button
            key={kind}
            type="button"
            className={state.placing?.mode === "generic" && state.placing.kind === kind ? "on" : ""}
            onClick={() => dispatch({ type: "place-generic", kind, name })}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="panel-scroll">
        {query ? (
          <SymbolGrid symbols={symbols} placingId={placingId} favorites={state.favorites} affiliation={state.galleryAffiliation} />
        ) : (
          [...(grouped || [])].map(([category, subs]) => {
            const catKey = `${section}:${category}`;
            const open = state.openGroups[catKey] ?? category === "Movement and Maneuver";
            return (
              <div key={catKey}>
                <button type="button" className="subhead" onClick={() => dispatch({ type: "toggle-group", key: catKey })}>
                  <span>{category}</span>
                  <span>{open ? "▾" : "▸"}</span>
                </button>
                {open &&
                  (() => {
                    const entries = [...subs.entries()];
                    const singles = entries.filter(([, items]) => items.length === 1).flatMap(([, items]) => items);
                    const groups = entries.filter(([, items]) => items.length > 1);
                    return (
                      <>
                        {singles.length > 0 && (
                          <SymbolGrid symbols={singles} placingId={placingId} favorites={state.favorites} affiliation={state.galleryAffiliation} />
                        )}
                        {groups.map(([sub, items]) => {
                          if (sub === category) {
                            return (
                              <SymbolGrid key={`${catKey}:${sub}`} symbols={items} placingId={placingId} favorites={state.favorites} affiliation={state.galleryAffiliation} />
                            );
                          }
                          const subKey = `${catKey}:${sub}`;
                          const subOpen = state.openGroups[subKey] ?? (category === "Movement and Maneuver" && sub === "Infantry");
                          return (
                            <div key={subKey} className="subgroup">
                              <button type="button" className="subhead minor" onClick={() => dispatch({ type: "toggle-group", key: subKey })}>
                                <span>{sub}</span>
                                <span>{subOpen ? "▾" : "▸"}</span>
                              </button>
                              {subOpen && (
                                <SymbolGrid symbols={items} placingId={placingId} favorites={state.favorites} affiliation={state.galleryAffiliation} />
                              )}
                            </div>
                          );
                        })}
                      </>
                    );
                  })()}
              </div>
            );
          })
        )}
        {!symbols.length && <p className="empty">No symbols in this set.</p>}
      </div>
    </aside>
  );
}

function SymbolGrid({
  symbols,
  placingId,
  favorites,
  affiliation,
}: {
  symbols: CatalogSymbol[];
  placingId: string | null;
  favorites: string[];
  affiliation: Affiliation;
}) {
  const { dispatch } = useMapStore();
  return (
    <div className="symbol-grid">
      {symbols.map((symbol) => (
        <button
          key={symbol.id}
          type="button"
          className={`symbol-cell side-${affiliation.toLowerCase()}${placingId === symbol.id ? " on" : ""}`}
          title={symbol.name}
          aria-label={symbol.name}
          onClick={() => dispatch({ type: "place-symbol", symbol })}
          onContextMenu={(event) => {
            event.preventDefault();
            dispatch({ type: "toggle-favorite", id: symbol.id });
          }}
        >
          <SymbolThumb symbol={symbol} />
          {favorites.includes(symbol.id) && <i className="fav">★</i>}
        </button>
      ))}
    </div>
  );
}

export function EditorPanel() {
  const { state, dispatch } = useMapStore();
  const graphic = state.graphics.find((item) => item.id === state.selectedId);
  return (
    <aside className="panel panel-right">
      <header className="panel-head">
        <strong>Symbol Editor</strong>
        <button type="button" onClick={() => dispatch({ type: "toggle-right", panel: "editor" })} aria-label="Close">
          ×
        </button>
      </header>
      {!graphic ? (
        <p className="empty">Select a graphic on the map.</p>
      ) : (
        <div className="panel-scroll editor">
          <div className="editor-preview">
            <GraphicThumb graphic={graphic} />
            <div>
              <input
                value={graphic.name}
                aria-label="Name"
                onChange={(event) => dispatch({ type: "patch", id: graphic.id, patch: { name: event.target.value } })}
              />
              <small>{graphic.renderer === "symbol" ? "MIL-STD-2525" : "Generic graphic"}</small>
            </div>
          </div>
          {graphic.renderer === "symbol" && (
            <>
              <div className="affil-row">
                {AFFILIATIONS.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    className={graphic.affiliation === item.code ? "on" : ""}
                    style={{ borderColor: affiliationColor(item.code) }}
                    onClick={() => dispatch({ type: "patch", id: graphic.id, patch: { affiliation: item.code } })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <label className="opt-row">
                Status
                <select
                  value={graphic.status}
                  onChange={(event) =>
                    dispatch({ type: "patch", id: graphic.id, patch: { status: event.target.value as Graphic["status"] } })
                  }
                >
                  <option value="P">Present</option>
                  <option value="A">Anticipated</option>
                </select>
              </label>
              {symbolAllows(graphic, state.options.standard, FIELD.echelon) && (
                <label className="opt-row">
                  Unit size
                  <select
                    value={graphic.echelon}
                    onChange={(event) => dispatch({ type: "patch", id: graphic.id, patch: { echelon: event.target.value } })}
                  >
                    {ECHELONS.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {symbolAllows(graphic, state.options.standard, FIELD.headquarters) && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={graphic.headquarters}
                    onChange={(event) => dispatch({ type: "patch", id: graphic.id, patch: { headquarters: event.target.checked } })}
                  />
                  Headquarters
                </label>
              )}
              {symbolAllows(graphic, state.options.standard, FIELD.taskForce) && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={graphic.taskForce}
                    onChange={(event) => dispatch({ type: "patch", id: graphic.id, patch: { taskForce: event.target.checked } })}
                  />
                  Task force
                </label>
              )}
              {symbolAllows(graphic, state.options.standard, FIELD.feint) && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={graphic.feint}
                    onChange={(event) => dispatch({ type: "patch", id: graphic.id, patch: { feint: event.target.checked } })}
                  />
                  Feint / dummy
                </label>
              )}
            </>
          )}
          {graphic.renderer === "generic" && (
            <label className="opt-row">
              Color
              <input
                type="color"
                value={graphic.color}
                onChange={(event) => dispatch({ type: "patch", id: graphic.id, patch: { color: event.target.value } })}
              />
            </label>
          )}
          <ModifierFields graphic={graphic} />
          <div className="button-row">
            <button type="button" onClick={() => dispatch({ type: "duplicate", id: graphic.id })}>
              Duplicate
            </button>
            <button type="button" className="danger" onClick={() => dispatch({ type: "remove", id: graphic.id })}>
              Delete
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function ModifierFields({ graphic }: { graphic: Graphic }) {
  const { state, dispatch } = useMapStore();
  const fields = TEXT_MODIFIERS.filter((field) => symbolAllows(graphic, state.options.standard, field.modifier));
  return (
    <>
      {fields.map((field) => (
        <label key={field.key} className="stack-field">
          {field.label}
          {field.key === "reinforcedReduced" ? (
            <select
              value={["", "+", "-", "±"].includes(graphic.modifiers.reinforcedReduced) ? graphic.modifiers.reinforcedReduced : ""}
              onChange={(event) =>
                dispatch({ type: "modifiers", id: graphic.id, modifiers: { reinforcedReduced: event.target.value } })
              }
            >
              <option value="">None</option>
              <option value="+">Reinforced (+)</option>
              <option value="-">Reduced (−)</option>
              <option value="±">Reinforced and reduced (±)</option>
            </select>
          ) : (
            <input
              value={graphic.modifiers[field.key]}
              onChange={(event) =>
                dispatch({ type: "modifiers", id: graphic.id, modifiers: { [field.key]: event.target.value } })
              }
            />
          )}
        </label>
      ))}
    </>
  );
}

export function PointListPanel() {
  const { state, dispatch } = useMapStore();
  const graphic = state.graphics.find((item) => item.id === state.selectedId);
  return (
    <aside className="panel panel-right">
      <header className="panel-head">
        <strong>Point List</strong>
        <button type="button" onClick={() => dispatch({ type: "toggle-right", panel: "points" })} aria-label="Close">
          ×
        </button>
      </header>
      {!graphic ? (
        <p className="empty">Select a graphic to edit its coordinates.</p>
      ) : (
        <div className="panel-scroll">
          {graphic.coordinates.map((coord, index) => (
            <label key={`${graphic.id}-${index}`} className="stack-field">
              Point {index + 1}
              <input
                key={`${graphic.id}-${index}-${coord[0].toFixed(5)}-${coord[1].toFixed(5)}`}
                defaultValue={`${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`}
                onBlur={(event) => {
                  const parsed = parseCoordinate(event.target.value);
                  if (!parsed) return;
                  const coordinates = graphic.coordinates.map((item, i) => (i === index ? parsed : item)) as [
                    number,
                    number,
                  ][];
                  dispatch({ type: "move", id: graphic.id, coordinates });
                }}
              />
              <small>{formatLatLng(coord[0], coord[1], "mgrs")}</small>
            </label>
          ))}
          <label className="stack-field">
            Direction (°)
            <input
              value={graphic.modifiers.direction}
              onChange={(event) =>
                dispatch({ type: "modifiers", id: graphic.id, modifiers: { direction: event.target.value } })
              }
            />
          </label>
        </div>
      )}
    </aside>
  );
}

export function LayersPanel() {
  const { state, dispatch } = useMapStore();
  return (
    <aside className="panel panel-left">
      <header className="panel-head">
        <strong>Local MilX Layers</strong>
        <button type="button" onClick={() => dispatch({ type: "add-layer" })}>
          New Layer
        </button>
      </header>
      <div className="panel-scroll">
        {state.layers.map((layer) => (
          <div key={layer.id} className={`layer-row${layer.id === state.activeLayerId ? " active" : ""}`}>
            <button type="button" className="layer-name" onClick={() => dispatch({ type: "activate-layer", id: layer.id })}>
              {layer.name}
            </button>
            <input
              aria-label={`Rename ${layer.name}`}
              defaultValue={layer.name}
              onBlur={(event) => dispatch({ type: "rename-layer", id: layer.id, name: event.target.value || layer.name })}
            />
            <button
              type="button"
              title={layer.visible ? "Hide" : "Show"}
              onClick={() => dispatch({ type: "patch-layer", id: layer.id, patch: { visible: !layer.visible } })}
            >
              {layer.visible ? "◉" : "○"}
            </button>
            <button
              type="button"
              title={layer.locked ? "Unlock" : "Lock"}
              onClick={() => dispatch({ type: "patch-layer", id: layer.id, patch: { locked: !layer.locked } })}
            >
              {layer.locked ? "🔒" : "✎"}
            </button>
            <button type="button" title="Delete layer" onClick={() => dispatch({ type: "delete-layer", id: layer.id })}>
              ×
            </button>
          </div>
        ))}
        <GeoJsonImport />
      </div>
    </aside>
  );
}

function GeoJsonImport() {
  const { state, dispatch } = useMapStore();
  return (
    <label className="import-row">
      Vector layer — import GeoJSON
      <input
        type="file"
        accept=".json,.geojson,application/geo+json"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            const data = JSON.parse(await file.text()) as GeoJSON.FeatureCollection | GeoJSON.Feature;
            const features = data.type === "FeatureCollection" ? data.features : [data];
            const graphics: Graphic[] = [];
            for (const feature of features) {
              if (!feature.geometry) continue;
              const name = String(feature.properties?.name || file.name.replace(/\.geojson$/i, ""));
              if (feature.geometry.type === "Point") {
                graphics.push(genericGraphic(state.activeLayerId, "pin", name, [feature.geometry.coordinates as [number, number]]));
              } else if (feature.geometry.type === "LineString") {
                graphics.push(genericGraphic(state.activeLayerId, "line", name, feature.geometry.coordinates as [number, number][]));
              } else if (feature.geometry.type === "Polygon") {
                graphics.push(genericGraphic(state.activeLayerId, "area", name, feature.geometry.coordinates[0] as [number, number][]));
              }
            }
            if (graphics.length) dispatch({ type: "import-graphics", graphics });
          } catch {
            /* ignore unreadable files */
          }
        }}
      />
    </label>
  );
}

function genericGraphic(layerId: string, kind: Graphic["kind"], name: string, coordinates: [number, number][]): Graphic {
  return {
    id: crypto.randomUUID(),
    layerId,
    name,
    renderer: "generic",
    kind,
    basicId: "",
    affiliation: "F",
    status: "P",
    echelon: "00",
    headquarters: false,
    taskForce: false,
    feint: false,
    color: "#1565c0",
    coordinates,
    modifiers: { ...EMPTY_MODIFIERS },
  };
}

export function ActiveLayerPanel() {
  const { state, dispatch } = useMapStore();
  const layer = state.layers.find((item) => item.id === state.activeLayerId);
  const graphics = state.graphics.filter((graphic) => graphic.layerId === state.activeLayerId);
  return (
    <aside className="panel panel-left">
      <header className="panel-head">
        <strong>{layer?.name || "Layer"}</strong>
        <button type="button" onClick={() => dispatch({ type: "toggle-left", panel: "active" })} aria-label="Close">
          ×
        </button>
      </header>
      <div className="panel-scroll">
        {!graphics.length && <p className="empty">This layer is empty.</p>}
        {graphics.map((graphic) => (
          <button
            key={graphic.id}
            type="button"
            className={`graphic-row${graphic.id === state.selectedId ? " on" : ""}`}
            onClick={() => dispatch({ type: "select", id: graphic.id })}
          >
            <GraphicThumb graphic={graphic} />
            <span>
              {graphic.modifiers.uniqueDesignation || graphic.name}
              <small>{graphic.name}</small>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

export function OptionsPanel() {
  const { state, dispatch } = useMapStore();
  const options = state.options;
  const set = (patch: Partial<ViewOptions>) => dispatch({ type: "options", patch });
  return (
    <aside className="panel panel-left options">
      <div className="panel-scroll">
        <details open>
          <summary>General</summary>
          <label className="opt-row">
            Work mode
            <select value={options.standard} onChange={(event) => set({ standard: event.target.value as ViewOptions["standard"] })}>
              <option value="2525">MIL-STD-2525</option>
              <option value="APP6">APP-6</option>
            </select>
          </label>
          <label className="opt-row">
            Theme
            <select value={options.theme} onChange={(event) => set({ theme: event.target.value as ViewOptions["theme"] })}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={options.hints} onChange={(event) => set({ hints: event.target.checked })} />
            Show hints
          </label>
        </details>
        <details open>
          <summary>Unit settings</summary>
          <label className="opt-row">
            Distance
            <select value={options.distanceUnit} onChange={(event) => set({ distanceUnit: event.target.value as ViewOptions["distanceUnit"] })}>
              <option value="metric">metric</option>
              <option value="imperial">imperial</option>
            </select>
          </label>
          <label className="opt-row">
            Angular
            <select value={options.angularUnit} onChange={(event) => set({ angularUnit: event.target.value as ViewOptions["angularUnit"] })}>
              <option value="degree">Degree</option>
              <option value="mils">NATO mils</option>
            </select>
          </label>
          <label className="opt-row">
            Coordinates
            <select value={options.geoFormat} onChange={(event) => set({ geoFormat: event.target.value as ViewOptions["geoFormat"] })}>
              <option value="decimal">decimal</option>
              <option value="dms">deg min sec</option>
              <option value="mgrs">MGRS</option>
            </select>
          </label>
        </details>
        <details open>
          <summary>Map settings</summary>
          <label className="opt-row">
            Map type
            <select value={options.mapType} onChange={(event) => set({ mapType: event.target.value as ViewOptions["mapType"] })}>
              <option value="terrain">Terrain</option>
              <option value="streets">Streets</option>
              <option value="satellite">Satellite</option>
            </select>
          </label>
          <label className="opt-row">
            Brightness {options.brightness}
            <input type="range" min={-60} max={60} value={options.brightness} onChange={(event) => set({ brightness: Number(event.target.value) })} />
          </label>
          <label className="opt-row">
            Hue {options.hue}
            <input type="range" min={-180} max={180} value={options.hue} onChange={(event) => set({ hue: Number(event.target.value) })} />
          </label>
          <label className="opt-row">
            Chroma {options.chroma}
            <input type="range" min={0} max={200} value={options.chroma} onChange={(event) => set({ chroma: Number(event.target.value) })} />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={options.coordinateSearch} onChange={(event) => set({ coordinateSearch: event.target.checked })} />
            Coordinate search
          </label>
          <label className="check-row">
            <input type="checkbox" checked={options.measure} onChange={(event) => set({ measure: event.target.checked })} />
            Measure tools
          </label>
          <label className="check-row">
            <input type="checkbox" checked={options.cursorCoordinate} onChange={(event) => set({ cursorCoordinate: event.target.checked })} />
            Display cursor coordinate
          </label>
          <label className="check-row">
            <input type="checkbox" checked={options.showScale} onChange={(event) => set({ showScale: event.target.checked })} />
            Show scale
          </label>
          <label className="check-row">
            <input type="checkbox" checked={options.grid} onChange={(event) => set({ grid: event.target.checked })} />
            Coordinate grid
          </label>
        </details>
        <details open>
          <summary>Symbol format</summary>
          <label className="opt-row">
            Size {options.symbolSize}
            <input type="range" min={20} max={72} value={options.symbolSize} onChange={(event) => set({ symbolSize: Number(event.target.value) })} />
          </label>
          <label className="opt-row">
            Line width {options.strokeWidth}
            <input type="range" min={1} max={6} step={0.5} value={options.strokeWidth} onChange={(event) => set({ strokeWidth: Number(event.target.value) })} />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={options.symbolFill} onChange={(event) => set({ symbolFill: event.target.checked })} />
            Symbol filled
          </label>
          <label className="check-row">
            <input type="checkbox" checked={options.symbolFrame} onChange={(event) => set({ symbolFrame: event.target.checked })} />
            Framed
          </label>
          <label className="check-row">
            <input type="checkbox" checked={options.shadow} onChange={(event) => set({ shadow: event.target.checked })} />
            Show shadow
          </label>
        </details>
      </div>
    </aside>
  );
}

export function PrintPanel({ mapRef }: { mapRef: MutableRefObject<Map | null> }) {
  const { dispatch } = useMapStore();
  const [error, setError] = useState("");
  return (
    <aside className="panel panel-left">
      <header className="panel-head">
        <strong>Print & Export</strong>
        <button type="button" onClick={() => dispatch({ type: "toggle-left", panel: "print" })} aria-label="Close">
          ×
        </button>
      </header>
      <div className="panel-scroll">
        <p>Download the current map view, symbols included.</p>
        <button
          type="button"
          className="primary"
          onClick={() => {
            const canvas = mapRef.current?.getCanvas();
            if (!canvas) return;
            try {
              const link = document.createElement("a");
              link.href = canvas.toDataURL("image/png");
              link.download = "mission-map.png";
              link.click();
              setError("");
            } catch {
              setError("The map canvas could not be exported. The tile host blocked the image read.");
            }
          }}
        >
          Download PNG
        </button>
        <button type="button" onClick={() => window.print()}>
          Print
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </aside>
  );
}

export function MessageCenter() {
  const { dispatch } = useMapStore();
  return (
    <aside className="panel panel-info">
      <header className="panel-head">
        <strong>Message & Info</strong>
        <button type="button" onClick={() => dispatch({ type: "info", open: false })} aria-label="Close">
          ×
        </button>
      </header>
      <div className="panel-scroll">
        <p>Plan a mission on the map. Drop MIL-STD-2525 and APP-6 symbols, draw control measures, and keep them on layers.</p>
        <p>Symbols are the published MIL-STD-2525D plates, drawn by the <a href="https://github.com/missioncommand/mil-sym-ts">US Army mil-sym renderer</a>. Right-click a symbol in the gallery to favorite it.</p>
        <p>Ctrl+Z undo, Ctrl+Y redo, Delete removes the selection, Enter finishes a line or area, Esc cancels placement.</p>
      </div>
    </aside>
  );
}

export function MeasureReadout() {
  const { state, dispatch } = useMapStore();
  if (!state.options.measure || state.measurePts.length < 2) return null;
  const meters = pathLength(state.measurePts);
  const area = ringArea(state.measurePts);
  return (
    <div className="measure-chip">
      {formatDistance(meters, state.options.distanceUnit)}
      {state.measurePts.length >= 3 ? ` · ${formatAreaLabel(area, state.options.distanceUnit)}` : ""}
      <button type="button" onClick={() => dispatch({ type: "clear-measure" })}>
        Clear
      </button>
    </div>
  );
}

function formatAreaLabel(m2: number, unit: ViewOptions["distanceUnit"]) {
  return ringArea.length ? formatArea(m2, unit) : "";
}

function formatArea(m2: number, unit: ViewOptions["distanceUnit"]) {
  if (unit === "imperial") {
    const acres = m2 / 4046.8564224;
    return acres >= 640 ? `${(acres / 640).toFixed(2)} mi²` : `${acres.toFixed(1)} acres`;
  }
  return m2 >= 1_000_000 ? `${(m2 / 1_000_000).toFixed(2)} km²` : `${Math.round(m2).toLocaleString()} m²`;
}
