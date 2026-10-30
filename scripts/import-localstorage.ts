import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { serviceSupabase } from "../src/persistence/client";
import { parseExport, summarizeExport } from "../src/persistence/document";
import { SEED_IMPORT_KEY } from "../src/persistence/localCache";
import {
  createWorkspace,
  findWorkspaceByImportKey,
  loadWorkspace,
  saveSettings,
  saveWorkspace,
} from "../src/persistence/api";

const WORKSPACE_NAME = "Imported map";

type Flags = {
  file: string;
  email: string;
  userId: string;
  dryRun: boolean;
  help: boolean;
};

function loadEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    file: "seed/localstorage-export.json",
    email: "",
    userId: "",
    dryRun: false,
    help: false,
  };
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--help") flags.help = true;
    else if (arg === "--email") flags.email = argv[++index] ?? "";
    else if (arg === "--user-id") flags.userId = argv[++index] ?? "";
    else rest.push(arg);
  }
  if (rest[0]) flags.file = rest[0];
  return flags;
}

function printHelp() {
  console.log(`Usage: npm run import:local -- [file] [--email you@example.com | --user-id uuid] [--dry-run]

Reads a localStorage export, remaps ids like "layer-new", and upserts one workspace.
Re-running updates that same workspace (import key ${SEED_IMPORT_KEY}).
The service role key is read from SUPABASE_SERVICE_ROLE_KEY and is never sent to the browser.`);
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  const filePath = path.resolve(flags.file);
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  const { document, unknownTopLevel } = parseExport(raw);
  if (unknownTopLevel.length) {
    console.log(`Keeping unknown top-level keys out of columns: ${unknownTopLevel.join(", ")}`);
  }
  const summary = summarizeExport(document);
  const graphics = summary.reduce((sum, layer) => sum + layer.graphics, 0);
  console.log(`File ${filePath}`);
  for (const layer of summary) console.log(`  ${layer.name || layer.id}: ${layer.graphics} graphics`);
  console.log(`Total: ${summary.length} layers, ${graphics} graphics`);

  if (flags.dryRun) {
    console.log("Dry run: no database writes.");
    return;
  }
  if (!flags.email && !flags.userId) {
    throw new Error("Pass --email or --user-id. Use --dry-run to validate without a database.");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The service role key stays out of frontend code.");
  }

  const client = serviceSupabase(url, serviceKey);
  let userId = flags.userId;
  if (!userId) {
    const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === flags.email.toLowerCase());
    if (!match) throw new Error(`No user with email ${flags.email}`);
    userId = match.id;
  }

  const existing = await findWorkspaceByImportKey(client, SEED_IMPORT_KEY);
  let workspaceId: string;
  let version: number;
  let aliases = new Map<string, string>();
  if (existing) {
    const loaded = await loadWorkspace(client, existing.id);
    if (!loaded) throw new Error("Import workspace disappeared.");
    workspaceId = loaded.id;
    version = loaded.version;
    aliases = loaded.aliases;
    console.log(`Updating workspace ${workspaceId} at version ${version}`);
  } else {
    const created = await createWorkspace(client, WORKSPACE_NAME, SEED_IMPORT_KEY, userId);
    workspaceId = created.id;
    version = created.version;
    console.log(`Creating workspace ${workspaceId}`);
  }

  let saved = await saveWorkspace(client, {
    workspaceId,
    expectedVersion: version,
    name: WORKSPACE_NAME,
    document,
    aliases,
    ownerId: userId,
  });
  if (!saved.ok && saved.conflict && saved.version) {
    const loaded = await loadWorkspace(client, workspaceId);
    if (!loaded) throw new Error("Import workspace disappeared during retry.");
    saved = await saveWorkspace(client, {
      workspaceId,
      expectedVersion: loaded.version,
      name: WORKSPACE_NAME,
      document,
      aliases: loaded.aliases,
      ownerId: userId,
    });
  }
  if (!saved.ok) throw new Error(saved.conflict ? "Version conflict" : saved.error);

  await saveSettings(
    client,
    {
      options: (document.options ?? {}) as Record<string, unknown>,
      favorites: document.favorites ?? [],
      lastWorkspaceId: workspaceId,
    },
    userId,
  );

  const [{ count: layerCount, error: layerError }, { count: graphicCount, error: graphicError }] = await Promise.all([
    client.from("layers").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    client.from("graphics").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
  ]);
  if (layerError) throw layerError;
  if (graphicError) throw graphicError;
  console.log(`Database: ${layerCount} layers, ${graphicCount} graphics (workspace version ${saved.version})`);
  if (layerCount !== summary.length || graphicCount !== graphics) {
    throw new Error(`Count mismatch. File has ${summary.length} layers and ${graphics} graphics.`);
  }
  console.log("Counts match.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
