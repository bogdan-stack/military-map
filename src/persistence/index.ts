export { browserSupabase, serviceSupabase, type DbClient } from "./client";
export { diffRecords, stableStringify } from "./diff";
export { documentHasWork, parseExport, summarizeExport, type ParsedExport } from "./document";
export { aliasesFromRows, isUuid, resolveAppId, type AliasTable } from "./ids";
export { BROWSER_IMPORT_KEY, readLocalCache, SEED_IMPORT_KEY, STORAGE_KEY, writeLocalCache } from "./localCache";
export { numericFromDb, rowsToDocument, workspaceToRows } from "./mapRows";
export {
  createWorkspace,
  findWorkspaceByImportKey,
  listWorkspaces,
  loadSettings,
  loadWorkspace,
  saveSettings,
  saveWorkspace,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  watchAuth,
  type LoadedWorkspace,
  type SaveResult,
  type UserSettings,
  type WorkspaceSummary,
} from "./api";
