import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Same switch as the map agent in mdmp-curs:
//   AGENT_MODEL_PROVIDER = gateway | opper
//   AGENT_MODEL          = the provider's model id
// Opper uses OPPER_API_KEY at its OpenAI-compatible endpoint.
// Default Opper model: DeepSeek V4 Flash.

const DEFAULTS = {
  gateway: "anthropic/claude-sonnet-5.5",
  opper: "deepinfra/deepseek-v4-flash-0731",
};

export function agentProvider() {
  return process.env.AGENT_MODEL_PROVIDER === "opper" ? "opper" : "gateway";
}

export function agentModelId() {
  return process.env.AGENT_MODEL ?? DEFAULTS[agentProvider()];
}

export function agentModel() {
  const id = agentModelId();
  if (agentProvider() === "gateway") return id;
  const opper = createOpenAICompatible({
    name: "opper",
    baseURL: process.env.OPPER_BASE_URL ?? "https://api.opper.ai/v3/compat",
    apiKey: process.env.OPPER_API_KEY,
    includeUsage: true,
  });
  return opper(id);
}

export function agentModelLabel() {
  return `${agentProvider()}:${agentModelId()}`;
}
