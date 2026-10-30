export const STORAGE_KEY = "military-map-v2";
export const BROWSER_IMPORT_KEY = "browser:military-map-v2";
export const SEED_IMPORT_KEY = "seed:localstorage-export";

export type SyncMeta = {
  workspaceId: string;
  version: number;
  pending: boolean;
};

export type LocalDocument = {
  layers: unknown[];
  graphics: unknown[];
  activeLayerId: string;
  options: object;
  favorites: unknown[];
  sync?: SyncMeta;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function readLocalCache(storage: Pick<StorageLike, "getItem">): LocalDocument | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<LocalDocument>;
  if (!parsed || typeof parsed !== "object") return null;
  return {
    layers: Array.isArray(parsed.layers) ? parsed.layers : [],
    graphics: Array.isArray(parsed.graphics) ? parsed.graphics : [],
    activeLayerId: typeof parsed.activeLayerId === "string" ? parsed.activeLayerId : "",
    options:
      parsed.options && typeof parsed.options === "object" && !Array.isArray(parsed.options)
        ? (parsed.options as object)
        : {},
    favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    sync: parsed.sync && typeof parsed.sync.workspaceId === "string" ? parsed.sync : undefined,
  };
}

export function writeLocalCache(storage: Pick<StorageLike, "setItem">, doc: LocalDocument): void {
  const payload: LocalDocument = {
    layers: doc.layers,
    graphics: doc.graphics,
    activeLayerId: doc.activeLayerId,
    options: doc.options,
    favorites: doc.favorites,
  };
  if (doc.sync) payload.sync = doc.sync;
  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
