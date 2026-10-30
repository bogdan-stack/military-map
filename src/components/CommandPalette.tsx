"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Map } from "maplibre-gl";
import { getCatalog } from "@/lib/catalog";
import { parseCoordinate } from "@/lib/geo";
import { useMapStore } from "@/lib/store";

type Item = { id: string; label: string; hint?: string; run: () => void };

export function CommandPalette({
  open,
  mapRef,
  onClose,
}: {
  open: boolean;
  mapRef: RefObject<Map | null>;
  onClose: () => void;
}) {
  const { state, dispatch } = useMapStore();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const items = useMemo(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    const show = (panel: "layers" | "active" | "print" | "options") => {
      if (state.left !== panel) dispatch({ type: "toggle-left", panel });
    };
    const commands: Item[] = [
      {
        id: "mcoo",
        label: state.options.mcoo ? "Hide MCOO" : "Show MCOO",
        run: () => dispatch({ type: "options", patch: { mcoo: !state.options.mcoo } }),
      },
      { id: "layers", label: "Open Layers", run: () => show("layers") },
      { id: "gallery", label: "Open symbol gallery", run: () => { if (state.right !== "gallery") dispatch({ type: "toggle-right", panel: "gallery" }); } },
      { id: "settings", label: "Open Settings", run: () => show("options") },
      {
        id: "theme",
        label: state.options.theme === "night" ? "Use light theme" : "Use night theme",
        run: () => dispatch({ type: "options", patch: { theme: state.options.theme === "night" ? "light" : "night" } }),
      },
      { id: "print", label: "Open Print", run: () => show("print") },
      { id: "undo", label: "Undo", hint: "Ctrl+Z", run: () => dispatch({ type: "undo" }) },
      { id: "redo", label: "Redo", hint: "Ctrl+Shift+Z", run: () => dispatch({ type: "redo" }) },
      {
        id: "delete",
        label: state.selectedIds.length > 1 ? `Delete ${state.selectedIds.length} symbols` : "Delete selection",
        hint: "Delete",
        run: () => {
          const ids = state.selectedIds.length ? state.selectedIds : state.selectedId ? [state.selectedId] : [];
          if (ids.length) dispatch({ type: "remove", ids });
        },
      },
    ];
    const matched = commands.filter((item) => !q || item.label.toLowerCase().includes(q));
    const point = q ? parseCoordinate(query) : null;
    const places: Item[] = point
      ? [
          {
            id: "go",
            label: `Go to ${query.trim()}`,
            run: () => {
              const map = mapRef.current;
              if (!map) return;
              map.flyTo({ center: point, zoom: Math.max(map.getZoom(), 12) });
            },
          },
        ]
      : [];
    const symbols: Item[] =
      q.length >= 2
        ? getCatalog()
            .filter((symbol) => symbol.name.toLowerCase().includes(q))
            .slice(0, 8)
            .map((symbol) => ({
              id: symbol.id,
              label: symbol.name,
              hint: "Place",
              run: () => dispatch({ type: "place-symbol", symbol }),
            }))
        : [];
    return [...places, ...matched, ...symbols].slice(0, 12);
  }, [dispatch, mapRef, open, query, state.left, state.options.mcoo, state.options.theme, state.right, state.selectedId, state.selectedIds]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;
  const current = Math.min(active, Math.max(0, items.length - 1));

  const choose = (item: Item | undefined) => {
    if (!item) return;
    item.run();
    onClose();
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Commands"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(items.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(items[current]);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder="Search symbols, coordinates, or commands"
          aria-label="Command search"
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="palette-list" role="listbox">
          {items.map((item, index) => (
            <li key={item.id}>
              <button type="button" role="option" aria-selected={index === current} onMouseEnter={() => setActive(index)} onClick={() => choose(item)}>
                {item.label}
                {item.hint && <span className="palette-hint">{item.hint}</span>}
              </button>
            </li>
          ))}
          {!items.length && <li className="palette-empty">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
