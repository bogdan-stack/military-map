import { isStepCount, tool, ToolLoopAgent } from "ai";
import type { Graphic } from "@/lib/types";
import { MAP_TOOLS, createMapToolState, runMapTool, type MapToolState } from "./map-tools";
import { agentModel } from "./model";
import { z } from "zod";

const INSTRUCTIONS = `You are a staff officer's map assistant. You read and edit the tactical map only through tools. A person accepts every change; you only stage it.

How to work:
- Start with get_map_state.
- Never invent a coordinate. resolve_position checks an MGRS grid or a longitude, latitude pair, and you use the point it returns.
- search_symbol with affiliation and echelon words ("enemy infantry platoon", "friendly phase line"), then add_symbol or draw_graphic with the basicId it returns.
- add_symbol is for a point symbol. draw_graphic is for a line or an area. A boundary names both sides with designation and designation2.
- If a tool returns an error, read its hint and fix the call.
- When the changes are staged, call submit_changeset once with a short summary. Nothing reaches the map until a person accepts it.
- Reply in plain sentences: what you staged, with handles, and that it awaits review.`;

const INPUTS = {
  get_map_state: z.object({ detail: z.enum(["overview", "summary"]).default("overview") }),
  query_features: z.object({ text: z.string().optional(), affiliation: z.enum(["F", "H", "N", "U"]).optional(), limit: z.number().int().min(1).max(50).default(20) }),
  resolve_position: z.object({ position: z.string().min(2) }),
  search_symbol: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(10).default(5) }),
  add_symbol: z.object({
    basicId: z.string().regex(/^\d{8}$/),
    position: z.string().min(2),
    affiliation: z.enum(["F", "H", "N", "U"]).default("F"),
    echelon: z.string().default("00"),
    designation: z.string().max(30).optional(),
    higher_formation: z.string().max(30).optional(),
    name: z.string().max(80).optional(),
  }),
  draw_graphic: z.object({
    graphic: z.string().min(2),
    points: z.array(z.string().min(2)).min(1).max(50),
    affiliation: z.enum(["F", "H", "N", "U"]).default("F"),
    name: z.string().max(80).optional(),
    designation: z.string().max(30).optional(),
    designation2: z.string().max(30).optional(),
  }),
  move_feature: z.object({ handle: z.string(), to: z.string().min(2) }),
  delete_feature: z.object({ handle: z.string() }),
  undo: z.object({ count: z.number().int().min(1).max(20).default(1) }),
  submit_changeset: z.object({ summary: z.string().min(3).max(500) }),
} as const;

export function createMapAgent(graphics: Graphic[]) {
  const state = createMapToolState(graphics);
  const agent = new ToolLoopAgent({
    model: agentModel(),
    instructions: INSTRUCTIONS,
    tools: Object.fromEntries(
      MAP_TOOLS.map((item) => [
        item.name,
        tool({
          description: item.description,
          inputSchema: INPUTS[item.name as keyof typeof INPUTS],
          execute: async (input: unknown) => runMapTool(item.name, state, input),
        }),
      ]),
    ),
    stopWhen: isStepCount(12),
  });
  return { agent, state };
}

export type { MapToolState };
