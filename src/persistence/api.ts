import type { Session } from "@supabase/supabase-js";
import { browserSupabase, type DbClient } from "./client";
import type { Json } from "./database.types";
import type { AliasTable } from "./ids";
import { mergeAliases, rowsToDocument, workspaceToRows } from "./mapRows";

export type WorkspaceSummary = {
  id: string;
  name: string;
  updatedAt: string;
  version: number;
};

export type LoadedWorkspace = {
  id: string;
  name: string;
  version: number;
  importKey: string | null;
  document: ReturnType<typeof rowsToDocument>;
  aliases: AliasTable;
};

export type UserSettings = {
  options: Record<string, unknown>;
  favorites: unknown[];
  lastWorkspaceId: string | null;
};

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; version: number | null }
  | { ok: false; conflict?: false; error: string };

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function listWorkspaces(client: DbClient): Promise<WorkspaceSummary[]> {
  const { data, error } = await client
    .from("workspaces")
    .select("id, name, updated_at, version")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    version: row.version,
  }));
}

export async function loadWorkspace(client: DbClient, id: string): Promise<LoadedWorkspace | null> {
  const { data: workspace, error } = await client
    .from("workspaces")
    .select("id, name, version, active_layer_id, import_key")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!workspace) return null;

  const [{ data: layers, error: layerError }, { data: graphics, error: graphicError }] = await Promise.all([
    client.from("layers").select("*").eq("workspace_id", id).order("sort_order"),
    client.from("graphics").select("*").eq("workspace_id", id).order("sort_order"),
  ]);
  if (layerError) throw layerError;
  if (graphicError) throw graphicError;

  const layerRows = layers ?? [];
  const graphicRows = graphics ?? [];
  return {
    id: workspace.id,
    name: workspace.name,
    version: workspace.version,
    importKey: workspace.import_key,
    document: rowsToDocument(workspace.active_layer_id, layerRows, graphicRows),
    aliases: mergeAliases(layerRows, graphicRows),
  };
}

export async function createWorkspace(
  client: DbClient,
  name: string,
  importKey: string | null,
  ownerId?: string,
): Promise<{ id: string; version: number }> {
  let owner = ownerId;
  if (!owner) {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    owner = data.user?.id;
  }
  if (!owner) throw new Error("unauthenticated");
  const { data, error } = await client
    .from("workspaces")
    .insert({ owner_id: owner, name, import_key: importKey })
    .select("id, version")
    .single();
  if (error) throw error;
  return { id: data.id, version: data.version };
}

export async function findWorkspaceByImportKey(
  client: DbClient,
  importKey: string,
): Promise<{ id: string; version: number; name: string } | null> {
  const { data, error } = await client
    .from("workspaces")
    .select("id, version, name")
    .eq("import_key", importKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveWorkspace(
  client: DbClient,
  input: {
    workspaceId: string;
    expectedVersion: number;
    name: string;
    document: { layers: object[]; graphics: object[]; activeLayerId?: string | null };
    aliases: AliasTable;
    ownerId?: string;
  },
): Promise<SaveResult> {
  const rows = workspaceToRows(input.document, input.aliases);
  const { data, error } = await client.rpc("save_workspace", {
    p_workspace_id: input.workspaceId,
    p_expected_version: input.expectedVersion,
    p_name: input.name,
    p_active_layer_id: rows.activeLayerId,
    p_layers: rows.layers as unknown as Json,
    p_graphics: rows.graphics as unknown as Json,
    ...(input.ownerId ? { p_owner_id: input.ownerId } : {}),
  });
  if (error) return { ok: false, error: error.message };
  return parseSaveResult(data);
}

export async function loadSettings(client: DbClient): Promise<UserSettings | null> {
  const { data, error } = await client
    .from("user_settings")
    .select("options, favorites, last_workspace_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    options: asObject(data.options),
    favorites: Array.isArray(data.favorites) ? data.favorites : [],
    lastWorkspaceId: data.last_workspace_id,
  };
}

export async function saveSettings(client: DbClient, settings: UserSettings, ownerId?: string): Promise<void> {
  let userId = ownerId;
  if (!userId) {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    userId = data.user?.id;
  }
  if (!userId) throw new Error("unauthenticated");
  const { error } = await client.from("user_settings").upsert({
    user_id: userId,
    options: settings.options as Json,
    favorites: settings.favorites as Json,
    last_workspace_id: settings.lastWorkspaceId,
  });
  if (error) throw error;
}

function parseSaveResult(data: Json): SaveResult {
  const row = asObject(data);
  if (row.ok === true) return { ok: true, version: Number(row.version) };
  if (row.conflict === true) {
    return { ok: false, conflict: true, version: typeof row.version === "number" ? row.version : null };
  }
  return { ok: false, error: typeof row.error === "string" ? row.error : "save_failed" };
}

export async function signInWithPassword(email: string, password: string): Promise<string | null> {
  const client = browserSupabase();
  if (!client) return "Supabase is not configured.";
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error?.message ?? null;
}

export async function signUpWithPassword(
  email: string,
  password: string,
): Promise<{ error: string | null; needsConfirmation: boolean }> {
  const client = browserSupabase();
  if (!client) return { error: "Supabase is not configured.", needsConfirmation: false };
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) return { error: error.message, needsConfirmation: false };
  return { error: null, needsConfirmation: !data.session };
}

export async function signOut(): Promise<void> {
  const client = browserSupabase();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export function watchAuth(onChange: (session: Session | null) => void): () => void {
  const client = browserSupabase();
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((_event, session) => onChange(session));
  return () => data.subscription.unsubscribe();
}
