import { forward } from "mgrs";
import { z } from "zod";
import { getCatalog } from "@/lib/catalog";
import { parseCoordinate } from "@/lib/geo";
import { EMPTY_MODIFIERS, type Affiliation, type CatalogSymbol, type Graphic } from "@/lib/types";

const AFFILIATION_WORDS: Record<string, Affiliation> = {
  friend: "F",
  friendly: "F",
  blue: "F",
  enemy: "H",
  hostile: "H",
  red: "H",
  neutral: "N",
  green: "N",
  unknown: "U",
};

const ECHELON_WORDS: Record<string, string> = {
  team: "11",
  crew: "11",
  squad: "12",
  section: "13",
  platoon: "14",
  plt: "14",
  company: "15",
  coy: "15",
  battery: "15",
  troop: "15",
  battalion: "16",
  bn: "16",
  squadron: "16",
  regiment: "17",
  brigade: "18",
  bde: "18",
  division: "21",
  div: "21",
  corps: "22",
};

type Action =
  | { type: "stage"; id: string }
  | { type: "delete"; id: string }
  | { type: "replace"; stageId: string; deleteId: string };

export type MapToolState = {
  live: Graphic[];
  staged: Graphic[];
  deleted: string[];
  actions: Action[];
};

export function createMapToolState(graphics: Graphic[]): MapToolState {
  return { live: graphics.map((graphic) => ({ ...graphic })), staged: [], deleted: [], actions: [] };
}

type ToolFailure = { ok: false; error: string; message: string; hint?: string };

function fail(code: string, message: string, extra?: { hint?: string }): ToolFailure {
  return { ok: false, error: code, message, ...extra };
}

function mgrsOf(point: [number, number]) {
  try {
    return forward(point);
  } catch {
    return "";
  }
}

function resolvePosition(text: string) {
  const point = parseCoordinate(text);
  if (!point) return fail("bad_position", `"${text}" is not an MGRS grid or a coordinate.`, { hint: "Pass an MGRS grid or longitude, latitude." });
  return { ok: true as const, point, mgrs: mgrsOf(point) };
}

function wordsOf(query: string) {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);
}

export function searchSymbols(query: string, limit = 5) {
  let affiliation: Affiliation | undefined;
  let echelon: string | undefined;
  const terms: string[] = [];
  for (const word of wordsOf(query)) {
    if (AFFILIATION_WORDS[word]) affiliation = AFFILIATION_WORDS[word];
    else if (ECHELON_WORDS[word]) echelon = ECHELON_WORDS[word];
    else terms.push(word);
  }
  const hits = getCatalog()
    .map((symbol) => {
      const name = symbol.name.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (name === term) score += 4;
        else if (name.split(/[^a-z0-9]+/).includes(term)) score += 2;
        else if (name.includes(term) || symbol.subcategory.toLowerCase().includes(term)) score += 1;
      }
      if (!score) return null;
      if (echelon && symbol.section === "formations") score += 1;
      return { symbol, score };
    })
    .filter((hit): hit is { symbol: CatalogSymbol; score: number } => Boolean(hit))
    .sort((a, b) => b.score - a.score || a.symbol.name.length - b.symbol.name.length)
    .slice(0, limit)
    .map(({ symbol, score }) => ({
      basicId: symbol.basicId,
      name: symbol.name,
      kind: symbol.kind,
      section: symbol.section,
      affiliation: affiliation ?? "F",
      echelon: echelon ?? "00",
      score,
    }));
  return { query, hits };
}

function visible(state: MapToolState) {
  return [...state.live.filter((graphic) => !state.deleted.includes(graphic.id)), ...state.staged];
}

function handleFor(state: MapToolState, graphic: Graphic) {
  const staged = state.staged.findIndex((item) => item.id === graphic.id);
  if (staged >= 0) return `N${staged + 1}`;
  const live = state.live.findIndex((item) => item.id === graphic.id);
  return live >= 0 ? `G${live + 1}` : "";
}

function findByHandle(state: MapToolState, handle: string) {
  return visible(state).find((graphic) => handleFor(state, graphic).toLowerCase() === handle.toLowerCase()) ?? null;
}

function row(state: MapToolState, graphic: Graphic) {
  const point = graphic.coordinates[0];
  return `${handleFor(state, graphic)} ${graphic.name || graphic.basicId} ${graphic.affiliation} ${point ? mgrsOf(point) : ""}`.trim();
}

function blankGraphic(partial: Pick<Graphic, "name" | "kind" | "basicId" | "affiliation" | "echelon" | "coordinates"> & { designation?: string; higher?: string; designation2?: string }): Graphic {
  return {
    id: crypto.randomUUID(),
    layerId: "agent",
    name: partial.name,
    renderer: partial.basicId ? "symbol" : "generic",
    kind: partial.kind,
    basicId: partial.basicId,
    affiliation: partial.affiliation,
    status: "P",
    echelon: partial.echelon,
    headquarters: false,
    taskForce: false,
    feint: false,
    color: "#1c1c1c",
    coordinates: partial.coordinates,
    modifiers: {
      ...EMPTY_MODIFIERS,
      uniqueDesignation: partial.designation ?? "",
      uniqueDesignation2: partial.designation2 ?? "",
      higherFormation: partial.higher ?? "",
    },
  };
}

function circle(center: [number, number], radiusM: number): [number, number][] {
  const ring: [number, number][] = [];
  for (let step = 0; step <= 16; step += 1) {
    const bearing = (step / 16) * Math.PI * 2;
    const lat = center[1] + (Math.cos(bearing) * radiusM) / 111320;
    const lng = center[0] + (Math.sin(bearing) * radiusM) / (111320 * Math.cos((center[1] * Math.PI) / 180));
    ring.push([lng, lat]);
  }
  return ring;
}

const position = z.string().min(2);
const affiliation = z.enum(["F", "H", "N", "U"]);

const tools = {
  get_map_state: {
    description: "One line per symbol on the map. Handles are G1 for a symbol already on the map and N1 for one you staged. Start here.",
    input: z.object({ detail: z.enum(["overview", "summary"]).default("overview") }),
    run(state: MapToolState, input: { detail: "overview" | "summary" }) {
      const graphics = visible(state);
      const header = `${graphics.length} symbols · staged ${state.staged.length}`;
      if (input.detail === "overview") return { ok: true, text: header };
      return { ok: true, text: [header, ...graphics.map((graphic) => row(state, graphic))].join("\n") };
    },
  },
  query_features: {
    description: "Find symbols by name or affiliation.",
    input: z.object({
      text: z.string().optional(),
      affiliation: affiliation.optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    run(state: MapToolState, input: { text?: string; affiliation?: Affiliation; limit: number }) {
      const needle = input.text?.toLowerCase() ?? "";
      const rows = visible(state)
        .filter((graphic) => !input.affiliation || graphic.affiliation === input.affiliation)
        .filter((graphic) => !needle || `${graphic.name} ${graphic.modifiers.uniqueDesignation}`.toLowerCase().includes(needle))
        .slice(0, input.limit)
        .map((graphic) => row(state, graphic));
      return { ok: true, matches: rows };
    },
  },
  resolve_position: {
    description: "Turn an MGRS grid or a longitude, latitude pair into a point. Never invent a coordinate.",
    input: z.object({ position }),
    run(_state: MapToolState, input: { position: string }) {
      return resolvePosition(input.position);
    },
  },
  search_symbol: {
    description: 'Find a symbol by words, including affiliation and echelon, for example "enemy infantry platoon" or "phase line". Use the basicId it returns.',
    input: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(10).default(5) }),
    run(_state: MapToolState, input: { query: string; limit: number }) {
      return { ok: true, ...searchSymbols(input.query, input.limit) };
    },
  },
  add_symbol: {
    description: "Stage a point symbol. Get basicId from search_symbol. Nothing is on the map until submit_changeset is accepted by a person.",
    input: z.object({
      basicId: z.string().regex(/^\d{8}$/),
      position,
      affiliation: affiliation.default("F"),
      echelon: z.string().default("00"),
      designation: z.string().max(30).optional(),
      higher_formation: z.string().max(30).optional(),
      name: z.string().max(80).optional(),
    }),
    run(state: MapToolState, input: { basicId: string; position: string; affiliation: Affiliation; echelon: string; designation?: string; higher_formation?: string; name?: string }) {
      const symbol = getCatalog().find((item) => item.basicId === input.basicId);
      if (!symbol) return fail("unknown_symbol", `${input.basicId} is not in the catalogue.`, { hint: "Call search_symbol first." });
      if (symbol.kind !== "point") return fail("not_a_point", `${symbol.name} is a ${symbol.kind}. Use draw_graphic.`, {});
      const at = resolvePosition(input.position);
      if (!at.ok) return at;
      const graphic = blankGraphic({
        name: input.name || input.designation || symbol.name,
        kind: "point",
        basicId: symbol.basicId,
        affiliation: input.affiliation,
        echelon: input.echelon,
        coordinates: [at.point],
        designation: input.designation,
        higher: input.higher_formation,
      });
      state.staged.push(graphic);
      state.actions.push({ type: "stage", id: graphic.id });
      return { ok: true, handle: handleFor(state, graphic), mgrs: at.mgrs, name: graphic.name, basicId: graphic.basicId };
    },
  },
  draw_graphic: {
    description: "Stage a line or area symbol. Pass a catalogue name or basicId, and the points in draw order. One point for an area draws a 1 km circle around it.",
    input: z.object({
      graphic: z.string().min(2),
      points: z.array(position).min(1).max(50),
      affiliation: affiliation.default("F"),
      name: z.string().max(80).optional(),
      designation: z.string().max(30).optional(),
      designation2: z.string().max(30).optional(),
    }),
    run(state: MapToolState, input: { graphic: string; points: string[]; affiliation: Affiliation; name?: string; designation?: string; designation2?: string }) {
      const byId = getCatalog().find((item) => item.basicId === input.graphic);
      const found = byId ?? getCatalog().find((item) => item.basicId === searchSymbols(input.graphic, 1).hits[0]?.basicId);
      if (!found || found.kind === "point") return fail("not_a_graphic", `"${input.graphic}" is not a line or area symbol.`, { hint: "search_symbol for a phase line, boundary, or objective." });
      const resolved = input.points.map(resolvePosition);
      const bad = resolved.find((item) => !item.ok);
      if (bad) return bad;
      const points = resolved.flatMap((item) => (item.ok ? [item.point] : []));
      const coordinates = found.kind === "area" && points.length === 1 ? circle(points[0], 1000) : points;
      if (found.kind === "line" && coordinates.length < 2) return fail("need_points", "A line needs at least two points.", {});
      if (found.kind === "area" && coordinates.length < 3) return fail("need_points", "An area needs at least three points, or one centre.", {});
      const graphic = blankGraphic({
        name: input.name || input.designation || found.name,
        kind: found.kind,
        basicId: found.basicId,
        affiliation: input.affiliation,
        echelon: "00",
        coordinates,
        designation: input.designation,
        designation2: input.designation2,
      });
      state.staged.push(graphic);
      state.actions.push({ type: "stage", id: graphic.id });
      return { ok: true, handle: handleFor(state, graphic), name: graphic.name, points: coordinates.length };
    },
  },
  move_feature: {
    description: "Stage a move of a symbol so its first point lands on the given position. The shape is kept.",
    input: z.object({ handle: z.string(), to: position }),
    run(state: MapToolState, input: { handle: string; to: string }) {
      const graphic = findByHandle(state, input.handle);
      if (!graphic) return fail("not_found", `${input.handle} is not on this map.`, {});
      const at = resolvePosition(input.to);
      if (!at.ok) return at;
      const from = graphic.coordinates[0];
      if (!from) return fail("nothing_to_move", `${input.handle} has no point.`, {});
      const delta: [number, number] = [at.point[0] - from[0], at.point[1] - from[1]];
      const moved: Graphic = { ...graphic, id: crypto.randomUUID(), coordinates: graphic.coordinates.map(([lng, lat]) => [lng + delta[0], lat + delta[1]]) };
      state.deleted.push(graphic.id);
      state.staged.push(moved);
      state.actions.push({ type: "replace", stageId: moved.id, deleteId: graphic.id });
      return { ok: true, handle: handleFor(state, moved), mgrs: at.mgrs };
    },
  },
  delete_feature: {
    description: "Stage the removal of a symbol. It stays until a person accepts the changeset.",
    input: z.object({ handle: z.string() }),
    run(state: MapToolState, input: { handle: string }) {
      const graphic = findByHandle(state, input.handle);
      if (!graphic) return fail("not_found", `${input.handle} is not on this map.`, {});
      state.deleted.push(graphic.id);
      state.staged = state.staged.filter((item) => item.id !== graphic.id);
      state.actions.push({ type: "delete", id: graphic.id });
      return { ok: true, removed: handleFor(state, graphic) || input.handle };
    },
  },
  undo: {
    description: "Drop the last staged change.",
    input: z.object({ count: z.number().int().min(1).max(20).default(1) }),
    run(state: MapToolState, input: { count: number }) {
      const removed = state.actions.splice(-input.count);
      for (const action of removed) {
        if (action.type === "stage") state.staged = state.staged.filter((item) => item.id !== action.id);
        else if (action.type === "delete") state.deleted = state.deleted.filter((id) => id !== action.id);
        else {
          state.staged = state.staged.filter((item) => item.id !== action.stageId);
          state.deleted = state.deleted.filter((id) => id !== action.deleteId);
        }
      }
      return { ok: true, removed: removed.length };
    },
  },
  submit_changeset: {
    description: "Propose the staged symbols for a person to accept. Nothing is drawn on the map by this call.",
    input: z.object({ summary: z.string().min(3).max(500) }),
    run(state: MapToolState, input: { summary: string }) {
      if (!state.actions.length) return fail("empty", "Nothing is staged.", { hint: "Stage a symbol first." });
      return {
        ok: true,
        status: "pending_review" as const,
        summary: input.summary,
        note: "A person must accept this before it reaches the map.",
        staged: state.staged.map((graphic) => ({ ...graphic, handle: handleFor(state, graphic) })),
        deleted: state.deleted,
      };
    },
  },
};

export const MAP_TOOLS = Object.entries(tools).map(([name, tool]) => ({ name, description: tool.description }));

export function runMapTool(name: string, state: MapToolState, raw: unknown) {
  const tool = tools[name as keyof typeof tools];
  if (!tool) return fail("unknown_tool", `No tool "${name}".`, { hint: MAP_TOOLS.map((item) => item.name).join(", ") });
  const parsed = tool.input.safeParse(raw ?? {});
  if (!parsed.success) return fail("bad_input", parsed.error.issues.slice(0, 4).map((issue) => issue.message).join(" "));
  return tool.run(state, parsed.data as never);
}

export function proposalOf(state: MapToolState) {
  return runMapTool("submit_changeset", state, { summary: "Staged by the map agent." });
}
