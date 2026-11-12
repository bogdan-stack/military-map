import { z } from "zod";
import { createMapAgent } from "@/lib/agent/agent";
import { agentModelLabel, agentProvider } from "@/lib/agent/model";
import { proposalOf } from "@/lib/agent/map-tools";
import type { Graphic } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const body = z.object({
  instruction: z.string().min(1).max(4000),
  graphics: z.array(z.custom<Graphic>()).default([]),
});

/** The map agent. It stages symbols with the same tools as mdmp-curs and does not draw them. */
export async function POST(request: Request) {
  if (agentProvider() === "opper" && !process.env.OPPER_API_KEY) {
    return Response.json({ error: "OPPER_API_KEY is not set." }, { status: 503 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send an instruction and the current symbols." }, { status: 400 });
  try {
    const { agent, state } = createMapAgent(parsed.data.graphics);
    const result = await agent.generate({ prompt: parsed.data.instruction });
    return Response.json({ text: result.text, model: agentModelLabel(), proposal: proposalOf(state) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The agent failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
