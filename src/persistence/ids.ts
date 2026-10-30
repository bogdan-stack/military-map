const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AliasTable = Map<string, string>;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Map an app id onto a uuid. Non-UUID ids such as "layer-new" keep a stable uuid in `aliases`. */
export function resolveAppId(appId: string, aliases: AliasTable): { id: string; legacyId: string | null } {
  if (isUuid(appId)) return { id: appId, legacyId: null };
  const existing = aliases.get(appId);
  if (existing) return { id: existing, legacyId: appId };
  const id = crypto.randomUUID();
  aliases.set(appId, id);
  return { id, legacyId: appId };
}

export function aliasesFromRows(
  rows: { id: string; legacy_id: string | null }[],
): AliasTable {
  const aliases: AliasTable = new Map();
  for (const row of rows) {
    if (row.legacy_id) aliases.set(row.legacy_id, row.id);
  }
  return aliases;
}
