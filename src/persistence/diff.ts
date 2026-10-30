export type RecordDiff<T extends { id: string }> = {
  upsert: T[];
  remove: string[];
};

/** JSON with sorted keys so key order in the file does not look like an edit. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Changed rows are upserted. Ids present before and missing after are deleted. */
export function diffRecords<T extends { id: string }>(before: T[], after: T[]): RecordDiff<T> {
  const previous = new Map(before.map((item) => [item.id, stableStringify(item)]));
  const nextIds = new Set(after.map((item) => item.id));
  return {
    upsert: after.filter((item) => previous.get(item.id) !== stableStringify(item)),
    remove: [...previous.keys()].filter((id) => !nextIds.has(id)),
  };
}
