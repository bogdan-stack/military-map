"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { Map } from "maplibre-gl";
import { getCatalog, groupCatalog } from "@/lib/catalog";
import { GROUNDS, MOVEMENTS, type GroundCondition, type MovementClass } from "@/lib/mcoo/classify";
import { formatDistance, formatLatLng, parseCoordinate, pathLength, ringArea } from "@/lib/geo";
import { useMapStore } from "@/lib/store";
import { affiliationColor, canScaleGraphic, FIELD, frameColor, graphicRotation, graphicScale, isBoundary, renderMeasurePreview, renderSymbol, shownCoordinates, symbolAllows, TEXT_MODIFIERS, toBasePoint } from "@/lib/symbols";
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
    try {
      const graphic = synthetic(symbol, style);
      if (symbol.kind !== "point") return renderMeasurePreview(graphic, state.options) ?? "";
      return renderSymbol(graphic, state.options, size, false)?.svg ?? "";
    } catch {
      return "";
    }
  }, [size, state.options, style.affiliation, style.echelon, style.feint, style.headquarters, style.reinforced, style.status, style.taskForce, symbol]);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready || !svg) return <span className="thumb-svg" />;
  return <span className="thumb-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function GraphicThumb({ graphic }: { graphic: Graphic }) {
  const { state } = useMapStore();
  const svg = useMemo(() => {
    try {
      if (graphic.renderer !== "symbol") return "";
      if (graphic.kind !== "point") return renderMeasurePreview(graphic, state.options) ?? "";
      return renderSymbol(graphic, state.options, 64, false)?.svg ?? "";
    } catch {
      return "";
    }
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

const SECTIONS: { id: SectionId; label: string; short: string; glyph: string }[] = [
  { id: "favorites", label: "My Favorites", short: "Favorites", glyph: "★" },
  { id: "formations", label: "Formations", short: "Formations", glyph: "▣" },
  { id: "equipment", label: "Equipment and Installations", short: "Equipment", glyph: "⬡" },
  { id: "tactical", label: "Tactical Graphics", short: "Graphics", glyph: "⌖" },
  { id: "signals", label: "Signals Intelligence", short: "SIGINT", glyph: "📡" },
  { id: "stability", label: "Stability Operations", short: "Stability", glyph: "⚑" },
  { id: "emergency", label: "METOC", short: "METOC", glyph: "✚" },
];

const SEARCH_SECTIONS: Exclude<SectionId, "favorites">[] = ["formations", "equipment", "tactical", "signals", "stability", "emergency"];

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

  const recentSymbols = useMemo(
    () => state.recent.flatMap((id) => catalog.filter((symbol) => symbol.id === id)),
    [catalog, state.recent],
  );

  const searchGroups = useMemo(() => {
    if (!query) return [];
    return SEARCH_SECTIONS.map((id) => ({
      id,
      label: SECTIONS.find((item) => item.id === id)?.label ?? id,
      symbols: symbols.filter((symbol) => symbol.section === id),
    })).filter((group) => group.symbols.length > 0);
  }, [query, symbols]);

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
            aria-label={item.label}
            onClick={() => {
              dispatch({ type: "query", query: "" });
              dispatch({ type: "section", section: item.id });
            }}
          >
            <span aria-hidden="true">{item.glyph}</span>
            <small>{item.short}</small>
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
            aria-pressed={state.galleryAffiliation === item.code}
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
            ["bean", "Bean"],
          ] as const
        ).map(([kind, name]) => (
          <button
            key={kind}
            type="button"
            className={state.placing?.mode === "generic" && state.placing.kind === kind ? "on" : ""}
            title={kind === "bean" ? "Unit position. Click the center, then the far end." : name}
            aria-pressed={state.placing?.mode === "generic" && state.placing.kind === kind}
            onClick={() => dispatch({ type: "place-generic", kind, name })}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="panel-scroll">
        {!query && recentSymbols.length > 0 && (
          <section>
            <h3 className="search-section">Recent</h3>
            <SymbolGrid
              symbols={recentSymbols}
              placingId={placingId}
              favorites={state.favorites}
              affiliation={state.galleryAffiliation}
            />
          </section>
        )}
        {query
          ? searchGroups.map((group) => (
              <section key={group.id}>
                <h3 className="search-section">{group.label}</h3>
                <SymbolGroups
                  symbols={group.symbols}
                  section={group.id}
                  placingId={placingId}
                  favorites={state.favorites}
                  affiliation={state.galleryAffiliation}
                  defaultOpen
                />
              </section>
            ))
          : (
              <SymbolGroups
                symbols={symbols}
                section={section}
                placingId={placingId}
                favorites={state.favorites}
                affiliation={state.galleryAffiliation}
                defaultOpen={false}
              />
            )}
        {!symbols.length && <p className="empty">No symbols in this set.</p>}
      </div>
    </aside>
  );
}

function SymbolGroups({
  symbols,
  section,
  placingId,
  favorites,
  affiliation,
  defaultOpen,
}: {
  symbols: CatalogSymbol[];
  section: string;
  placingId: string | null;
  favorites: string[];
  affiliation: Affiliation;
  defaultOpen: boolean;
}) {
  const { state, dispatch } = useMapStore();
  const grouped = useMemo(() => groupCatalog(symbols), [symbols]);
  return (
    <>
      {[...grouped].map(([category, subs]) => {
        const catKey = `${section}:${category}`;
        const open = state.openGroups[catKey] ?? (defaultOpen || category === "Movement and Maneuver");
        const entries = [...subs.entries()];
        const singles = entries.filter(([, items]) => items.length === 1).flatMap(([, items]) => items);
        const groups = entries.filter(([, items]) => items.length > 1);
        return (
          <div key={catKey}>
            <button type="button" className="subhead" aria-expanded={open} onClick={() => dispatch({ type: "toggle-group", key: catKey })}>
              <span>{category}</span>
              <span>{open ? "▾" : "▸"}</span>
            </button>
            {open && (
              <>
                {singles.length > 0 && (
                  <SymbolGrid symbols={singles} placingId={placingId} favorites={favorites} affiliation={affiliation} />
                )}
                {groups.map(([sub, items]) => {
                  if (sub === category) {
                    return <SymbolGrid key={`${catKey}:${sub}`} symbols={items} placingId={placingId} favorites={favorites} affiliation={affiliation} />;
                  }
                  const subKey = `${catKey}:${sub}`;
                  const subOpen = state.openGroups[subKey] ?? (defaultOpen || (category === "Movement and Maneuver" && sub === "Infantry"));
                  return (
                    <div key={subKey} className="subgroup">
                      <button type="button" className="subhead minor" aria-expanded={subOpen} onClick={() => dispatch({ type: "toggle-group", key: subKey })}>
                        <span>{sub}</span>
                        <span>{subOpen ? "▾" : "▸"}</span>
                      </button>
                      {subOpen && <SymbolGrid symbols={items} placingId={placingId} favorites={favorites} affiliation={affiliation} />}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        );
      })}
    </>
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
        <div
          key={symbol.id}
          className={`symbol-cell side-${affiliation.toLowerCase()}${placingId === symbol.id ? " on" : ""}`}
          onContextMenu={(event) => {
            event.preventDefault();
            dispatch({ type: "toggle-favorite", id: symbol.id });
          }}
        >
          <button type="button" className="symbol-place" aria-label={symbol.name} onClick={() => dispatch({ type: "place-symbol", symbol })}>
            <SymbolThumb symbol={symbol} />
            <span className="symbol-name">{symbol.name}</span>
          </button>
          <button
            type="button"
            className={`fav-btn${favorites.includes(symbol.id) ? " on" : ""}`}
            aria-pressed={favorites.includes(symbol.id)}
            aria-label={favorites.includes(symbol.id) ? `Remove ${symbol.name} from favorites` : `Favorite ${symbol.name}`}
            onClick={() => dispatch({ type: "toggle-favorite", id: symbol.id })}
          >
            ★
          </button>
          <span className="symbol-card">{symbol.basicId}</span>
        </div>
      ))}
    </div>
  );
}

export function SymbolAdjust({ graphic, floating = false }: { graphic?: Graphic; floating?: boolean }) {
  if (!graphic || !canScaleGraphic(graphic)) return null;
  return (
    <div className={floating ? "scale-tool" : undefined}>
      <ScaleSlider graphic={graphic} />
      <RotationSlider graphic={graphic} />
    </div>
  );
}

function ScaleSlider({ graphic }: { graphic: Graphic }) {
  const { dispatch } = useMapStore();
  const from = useRef(1);
  const scale = graphicScale(graphic);
  return (
    <label className="opt-row">
      Symbol size
      <input
        type="range"
        min={0.25}
        max={4}
        step={0.05}
        value={scale}
        aria-label="Symbol size"
        onPointerDown={() => {
          from.current = graphicScale(graphic);
        }}
        onChange={(event) => dispatch({ type: "scale", id: graphic.id, scale: Number(event.target.value), history: false })}
        onPointerUp={(event) =>
          dispatch({ type: "scale", id: graphic.id, scale: Number(event.currentTarget.value), from: from.current })
        }
      />
      <span>{Math.round(scale * 100)}%</span>
    </label>
  );
}

function RotationSlider({ graphic }: { graphic: Graphic }) {
  const { dispatch } = useMapStore();
  const from = useRef(0);
  const rotation = graphicRotation(graphic);
  return (
    <label className="opt-row">
      Rotate
      <input
        type="range"
        min={-180}
        max={180}
        step={1}
        value={rotation}
        aria-label="Symbol rotation"
        onPointerDown={() => {
          from.current = graphicRotation(graphic);
        }}
        onChange={(event) => dispatch({ type: "rotate", id: graphic.id, rotation: Number(event.target.value), history: false })}
        onPointerUp={(event) =>
          dispatch({ type: "rotate", id: graphic.id, rotation: Number(event.currentTarget.value), from: from.current })
        }
      />
      <span>{Math.round(rotation)}°</span>
    </label>
  );
}

export function SymbolMenu() {
  const { state, dispatch } = useMapStore();
  const menu = state.menu;
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".symbol-menu")) return;
      dispatch({ type: "menu", menu: null });
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [dispatch, menu]);
  if (!menu) return null;
  const graphic = menu.id ? state.graphics.find((item) => item.id === menu.id) : undefined;
  const locked = Boolean(graphic && state.layers.find((item) => item.id === graphic.layerId)?.locked);
  const activeLocked = Boolean(state.layers.find((item) => item.id === state.activeLayerId)?.locked);
  return (
    <div className="symbol-menu" style={{ left: menu.x, top: menu.y }} role="menu">
      <button type="button" role="menuitem" disabled={!graphic || locked} onClick={() => graphic && dispatch({ type: "copy", id: graphic.id })}>
        Copy
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!state.clipboard || activeLocked}
        onClick={() => dispatch({ type: "paste", lng: menu.lng, lat: menu.lat })}
      >
        Paste
      </button>
      <button type="button" role="menuitem" disabled={!graphic || locked} onClick={() => graphic && dispatch({ type: "remove", ids: [graphic.id] })}>
        Delete
      </button>
    </div>
  );
}

function UndoField({
  value,
  label,
  onLive,
  onCommit,
}: {
  value: string;
  label: string;
  onLive: (value: string) => void;
  onCommit: (from: string, value: string) => void;
}) {
  const from = useRef<string | null>(null);
  return (
    <input
      value={value}
      aria-label={label}
      onFocus={() => {
        if (from.current === null) from.current = value;
      }}
      onChange={(event) => {
        if (from.current === null) from.current = value;
        onLive(event.target.value);
      }}
      onBlur={(event) => {
        const origin = from.current;
        from.current = null;
        if (origin !== null && event.target.value !== origin) onCommit(origin, event.target.value);
      }}
    />
  );
}

function ColorField({ graphic }: { graphic: Graphic }) {
  const { dispatch } = useMapStore();
  const from = useRef(graphic.color);
  const commit = (value: string) => {
    if (value === from.current) return;
    dispatch({ type: "patch", id: graphic.id, from: { color: from.current }, patch: { color: value } });
    from.current = value;
  };
  return (
    <input
      type="color"
      aria-label="Color"
      value={graphic.color}
      onPointerDown={() => {
        from.current = graphic.color;
      }}
      onChange={(event) => dispatch({ type: "patch", id: graphic.id, patch: { color: event.target.value }, history: false })}
      onBlur={(event) => commit(event.target.value)}
      onPointerUp={(event) => commit(event.currentTarget.value)}
    />
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
              <UndoField
                value={graphic.name}
                label="Name"
                onLive={(value) => dispatch({ type: "patch", id: graphic.id, patch: { name: value }, history: false })}
                onCommit={(from, value) => dispatch({ type: "patch", id: graphic.id, from: { name: from }, patch: { name: value } })}
              />
              <small>{graphic.renderer === "symbol" ? "MIL-STD-2525" : "Generic graphic"}</small>
            </div>
          </div>
          {(graphic.renderer === "symbol" || graphic.kind === "bean") && (
            <>
              <div className="affil-row">
                {AFFILIATIONS.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    className={graphic.affiliation === item.code ? "on" : ""}
                    style={{ borderColor: affiliationColor(item.code) }}
                    onClick={() =>
                      dispatch({
                        type: "patch",
                        id: graphic.id,
                        patch:
                          graphic.kind === "bean"
                            ? { affiliation: item.code, color: frameColor(item.code) }
                            : { affiliation: item.code },
                      })
                    }
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
              {(graphic.kind === "bean" || symbolAllows(graphic, state.options.standard, FIELD.echelon)) && (
                <label className="opt-row">
                  {isBoundary(graphic) ? "B" : "Unit size"}
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
              <SymbolAdjust graphic={graphic} />
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
          {graphic.renderer === "generic" && graphic.kind !== "bean" && (
            <label className="opt-row">
              Color
              <ColorField graphic={graphic} />
            </label>
          )}
          <ModifierFields graphic={graphic} />
          <div className="button-row">
            <button type="button" onClick={() => dispatch({ type: "duplicate", id: graphic.id })}>
              Duplicate
            </button>
            <button
              type="button"
              className="danger"
              onClick={() =>
                dispatch({
                  type: "remove",
                  ids: state.selectedIds.includes(graphic.id) ? state.selectedIds : [graphic.id],
                })
              }
            >
              {state.selectedIds.length > 1 && state.selectedIds.includes(graphic.id) ? `Delete ${state.selectedIds.length}` : "Delete"}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function boundaryFieldLabel(graphic: Graphic, key: string, fallback: string) {
  if (!isBoundary(graphic)) return fallback;
  if (key === "uniqueDesignation") return "T";
  if (key === "uniqueDesignation2") return "T1";
  return fallback;
}

function ModifierFields({ graphic }: { graphic: Graphic }) {
  const { state, dispatch } = useMapStore();
  const fields =
    graphic.kind === "bean"
      ? TEXT_MODIFIERS.filter((field) => field.key === "uniqueDesignation" || field.key === "higherFormation" || field.key === "additionalInformation")
      : TEXT_MODIFIERS.filter((field) => symbolAllows(graphic, state.options.standard, field.modifier));
  return (
    <>
      {fields.map((field) => (
        <label key={field.key} className="stack-field">
          {boundaryFieldLabel(graphic, field.key, field.label)}
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
            <UndoField
              value={graphic.modifiers[field.key]}
              label={boundaryFieldLabel(graphic, field.key, field.label)}
              onLive={(value) =>
                dispatch({ type: "modifiers", id: graphic.id, modifiers: { [field.key]: value }, history: false })
              }
              onCommit={(from, value) =>
                dispatch({
                  type: "modifiers",
                  id: graphic.id,
                  from: { [field.key]: from },
                  modifiers: { [field.key]: value },
                })
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
          {shownCoordinates(graphic).map((coord, index) => (
            <label key={`${graphic.id}-${index}`} className="stack-field">
              Point {index + 1}
              <input
                key={`${graphic.id}-${index}-${coord[0].toFixed(5)}-${coord[1].toFixed(5)}`}
                defaultValue={`${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`}
                onBlur={(event) => {
                  const parsed = parseCoordinate(event.target.value);
                  if (!parsed) return;
                  const scale = canScaleGraphic(graphic) ? graphicScale(graphic) : 1;
                  const rotation = canScaleGraphic(graphic) ? graphicRotation(graphic) : 0;
                  const base = toBasePoint(graphic.coordinates, scale, rotation, parsed);
                  const coordinates = graphic.coordinates.map((item, i) => (i === index ? base : item)) as [
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

function McooLayerRow() {
  const { state, dispatch } = useMapStore();
  const [open, setOpen] = useState(false);
  const options = state.options;
  const set = (patch: Partial<ViewOptions>) => dispatch({ type: "options", patch });
  const movement = MOVEMENTS.find((item) => item.id === options.mcooMovement)?.label ?? "Tracked";
  const ground = GROUNDS.find((item) => item.id === options.mcooGround)?.label ?? "Dry";
  return (
    <div className={`overlay-block${options.mcoo ? " on" : ""}`}>
      <div className="overlay-row">
        <button type="button" className="overlay-expand" aria-expanded={open} aria-label={open ? "Hide MCOO settings" : "MCOO settings"} onClick={() => setOpen((value) => !value)}>
          {open ? "▾" : "▸"}
        </button>
        <button type="button" className="overlay-name" onClick={() => set({ mcoo: !options.mcoo })}>
          <strong>MCOO</strong>
          <small>{options.mcoo ? `${movement} · ${ground}` : "Off"}</small>
        </button>
        <button
          type="button"
          role="switch"
          className={`switch${options.mcoo ? " on" : ""}`}
          aria-checked={options.mcoo}
          aria-label="MCOO"
          onClick={() => set({ mcoo: !options.mcoo })}
        />
      </div>
      {open && (
        <div className="overlay-details">
          <label className="mcoo-field">
            Movement
            <select value={options.mcooMovement} onChange={(event) => set({ mcooMovement: event.target.value as MovementClass })}>
              {MOVEMENTS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mcoo-field">
            Ground
            <select value={options.mcooGround} onChange={(event) => set({ mcooGround: event.target.value as GroundCondition })}>
              {GROUNDS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mcoo-field">
            Opacity {Math.round(options.mcooOpacity * 100)}%
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={options.mcooOpacity}
              aria-label="MCOO opacity"
              onChange={(event) => set({ mcooOpacity: Number(event.target.value) })}
            />
          </label>
          <div className="mcoo-legend">
            <div>
              <span className="mcoo-swatch restricted" /> Restricted
            </div>
            <div>
              <span className="mcoo-swatch severe" /> Severely restricted
            </div>
            <div>
              <span className="mcoo-swatch built" /> Built-up
            </div>
            <div>
              <span className="mcoo-swatch water" /> Water
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function LayersPanel() {
  const { state, dispatch } = useMapStore();
  return (
    <aside className="panel panel-left">
      <header className="panel-head">
        <strong>Layers</strong>
        <button type="button" onClick={() => dispatch({ type: "add-layer" })}>
          New Layer
        </button>
      </header>
      <div className="panel-scroll">
        <McooLayerRow />
        {state.layers.map((layer) => (
          <div key={layer.id} className={`layer-row${layer.id === state.activeLayerId ? " active" : ""}`}>
            <button type="button" className="layer-name" onClick={() => dispatch({ type: "activate-layer", id: layer.id })}>
              {layer.name}
            </button>
            <input
              key={`${layer.id}:${layer.name}`}
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
            className={`graphic-row${state.selectedIds.includes(graphic.id) ? " on" : ""}`}
            onClick={(event) => dispatch({ type: "select", id: graphic.id, shift: event.shiftKey })}
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
      <header className="panel-head">
        <strong>Settings</strong>
        <button type="button" onClick={() => dispatch({ type: "toggle-left", panel: "options" })} aria-label="Close settings">
          Close
        </button>
      </header>
      <div className="panel-scroll">
        <details>
          <summary>General</summary>
          <label className="opt-row">
            Symbology standard
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
              <option value="night">Night</option>
            </select>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={options.hints} onChange={(event) => set({ hints: event.target.checked })} />
            Show hints
          </label>
        </details>
        <details>
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
        <p>MCOO is the first row in Layers. Turn it on to draw restricted ground. Ctrl+K opens commands. Shift-click adds to the selection. Ctrl+Z undoes, Ctrl+Shift+Z redoes, Delete removes the selection, Enter finishes a line or area, Esc cancels placement.</p>
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
