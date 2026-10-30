"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import { DEFAULT_OPTIONS, type Graphic, type MapLayer, type ViewOptions } from "@/lib/types";
import {
  browserSupabase,
  BROWSER_IMPORT_KEY,
  createWorkspace,
  documentHasWork,
  findWorkspaceByImportKey,
  listWorkspaces,
  loadSettings,
  loadWorkspace,
  readLocalCache,
  saveSettings,
  saveWorkspace,
  signInWithPassword,
  signOut as supabaseSignOut,
  signUpWithPassword,
  stableStringify,
  watchAuth,
  writeLocalCache,
  type AliasTable,
} from "@/persistence";

const SAVE_DELAY_MS = 1500;
const WORKSPACE_NAME = "Mission";

export type SaveStatus = "saved" | "saving" | "offline" | "conflict" | "error";

type SyncState = {
  layers: MapLayer[];
  graphics: Graphic[];
  activeLayerId: string;
  options: ViewOptions;
  favorites: string[];
};

type HydrateAction = {
  type: "hydrate";
  state: Partial<SyncState>;
};

export type PersistenceControls = {
  status: SaveStatus;
  email: string | null;
  configured: boolean;
  offerUpload: boolean;
  conflictVersion: number | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  uploadLocal: () => Promise<string | null>;
  reloadRemote: () => Promise<void>;
  dismissUpload: () => void;
};

function snapshot(state: SyncState) {
  return {
    layers: state.layers,
    graphics: state.graphics,
    activeLayerId: state.activeLayerId,
    options: state.options,
    favorites: state.favorites,
  };
}

export function useWorkspaceSync(
  state: SyncState,
  dispatch: Dispatch<HydrateAction>,
  restoreGraphic: (graphic: Graphic, standard: ViewOptions["standard"]) => Graphic,
): PersistenceControls {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [email, setEmail] = useState<string | null>(null);
  const [configured] = useState(
    () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
  const [offerUpload, setOfferUpload] = useState(false);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const starterLayers = useRef(state.layers);
  const starterActive = useRef(state.activeLayerId);
  const baselineRef = useRef<string | null>(null);
  const aliasesRef = useRef<AliasTable>(new Map());
  const syncRef = useRef<{ workspaceId: string | null; version: number | null }>({
    workspaceId: null,
    version: null,
  });
  const userIdRef = useRef<string | null>(null);
  const skipRemoteRef = useRef(false);
  const stateRef = useRef(state);
  const savingRef = useRef(false);
  const queuedRef = useRef(false);
  const rawFavoritesRef = useRef<unknown[] | null>(null);
  stateRef.current = state;

  const applyRemote = useCallback(
    (doc: { layers: object[]; graphics: object[]; activeLayerId: string | null; options?: object; favorites?: unknown[] }, meta: { workspaceId: string; version: number }, aliases: AliasTable) => {
      aliasesRef.current = aliases;
      syncRef.current = meta;
      rawFavoritesRef.current = doc.favorites ?? [];
      skipRemoteRef.current = true;
      const options = { ...DEFAULT_OPTIONS, ...(doc.options as Partial<ViewOptions> | undefined) };
      dispatch({
        type: "hydrate",
        state: {
          layers: doc.layers.length ? (doc.layers as MapLayer[]) : starterLayers.current,
          graphics: (doc.graphics as Graphic[]).map((graphic) => restoreGraphic(graphic, options.standard)),
          activeLayerId: doc.activeLayerId || starterActive.current,
          options,
          favorites: (doc.favorites ?? []).filter((item): item is string => typeof item === "string"),
        },
      });
    },
    [dispatch, restoreGraphic],
  );

  const favoritesForSave = useCallback((current: string[]) => {
    const raw = rawFavoritesRef.current;
    if (!raw) return current;
    const strings = raw.filter((item): item is string => typeof item === "string");
    if (strings.length === current.length && strings.every((item, index) => item === current[index])) return raw;
    return current;
  }, []);

  const flush = useCallback(async () => {
    const client = browserSupabase();
    const doc = snapshot(stateRef.current);
    if (!client || !userIdRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline");
      return;
    }
    setStatus("saving");
    try {
      let workspaceId = syncRef.current.workspaceId;
      let version = syncRef.current.version;
      if (!workspaceId || version == null) {
        const created = await createWorkspace(client, WORKSPACE_NAME, null);
        workspaceId = created.id;
        version = created.version;
        syncRef.current = { workspaceId, version };
      }
      const result = await saveWorkspace(client, {
        workspaceId,
        expectedVersion: version,
        name: WORKSPACE_NAME,
        document: doc,
        aliases: aliasesRef.current,
      });
      if (!result.ok && result.conflict) {
        setStatus("conflict");
        setConflictVersion(result.version);
        return;
      }
      if (!result.ok) {
        setStatus("error");
        return;
      }
      syncRef.current.version = result.version;
      baselineRef.current = stableStringify(doc);
      setConflictVersion(null);
      setStatus("saved");
      await saveSettings(client, {
        options: doc.options as unknown as Record<string, unknown>,
        favorites: favoritesForSave(doc.favorites),
        lastWorkspaceId: syncRef.current.workspaceId,
      });
    } catch {
      setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    }
  }, [favoritesForSave]);

  const flushNow = useCallback(async () => {
    if (savingRef.current) {
      queuedRef.current = true;
      return;
    }
    savingRef.current = true;
    try {
      await flush();
    } finally {
      savingRef.current = false;
      if (queuedRef.current) {
        queuedRef.current = false;
        await flushNow();
      }
    }
  }, [flush]);

  useEffect(() => {
    try {
      const cached = readLocalCache(localStorage);
      if (cached && (cached.layers.length || cached.graphics.length || cached.activeLayerId)) {
        rawFavoritesRef.current = cached.favorites;
        const options = { ...DEFAULT_OPTIONS, ...(cached.options as Partial<ViewOptions>) };
        dispatch({
          type: "hydrate",
          state: {
            layers: cached.layers.length ? (cached.layers as MapLayer[]) : starterLayers.current,
            graphics: (cached.graphics as Graphic[]).map((graphic) => restoreGraphic(graphic, options.standard || "2525")),
            activeLayerId: cached.activeLayerId || starterActive.current,
            options,
            favorites: cached.favorites.filter((item): item is string => typeof item === "string"),
          },
        });
        if (cached.sync) syncRef.current = { workspaceId: cached.sync.workspaceId, version: cached.sync.version };
      }
    } catch {
      /* ignore broken local saves */
    }
    setReady(true);
  }, [dispatch, restoreGraphic]);

  useEffect(() => {
    if (!ready) return;
    const onOnline = () => {
      void flushNow();
    };
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flushNow, ready]);

  useEffect(() => {
    if (!ready) return;
    return watchAuth((session) => {
      userIdRef.current = session?.user.id ?? null;
      setEmail(session?.user.email ?? null);
      if (!session) {
        setOfferUpload(false);
        syncRef.current = { workspaceId: null, version: null };
        return;
      }
      void (async () => {
        const client = browserSupabase();
        if (!client) return;
        try {
          const settings = await loadSettings(client);
          let workspaceId = settings?.lastWorkspaceId ?? null;
          if (!workspaceId) {
            const list = await listWorkspaces(client);
            workspaceId = list[0]?.id ?? null;
          }
          const local = snapshot(stateRef.current);
          if (!workspaceId) {
            if (documentHasWork(local)) setOfferUpload(true);
            return;
          }
          const remote = await loadWorkspace(client, workspaceId);
          if (!remote) {
            if (documentHasWork(local)) setOfferUpload(true);
            return;
          }
          const cached = readLocalCache(localStorage);
          const pending = Boolean(cached?.sync?.pending && cached.sync.workspaceId === workspaceId);
          if (pending && cached?.sync && cached.sync.version !== remote.version) {
            aliasesRef.current = remote.aliases;
            syncRef.current = { workspaceId, version: remote.version };
            setStatus("conflict");
            setConflictVersion(remote.version);
            return;
          }
          if (pending && cached?.sync && cached.sync.version === remote.version) {
            aliasesRef.current = remote.aliases;
            syncRef.current = { workspaceId, version: remote.version };
            baselineRef.current = stableStringify({
              layers: remote.document.layers,
              graphics: remote.document.graphics,
              activeLayerId: remote.document.activeLayerId,
              options: { ...DEFAULT_OPTIONS, ...(settings?.options as Partial<ViewOptions> | undefined) },
              favorites: (settings?.favorites ?? []).filter((item): item is string => typeof item === "string"),
            });
            void flushNow();
            return;
          }
          const savedOptions = settings && Object.keys(settings.options).length ? settings.options : local.options;
          const savedFavorites = settings ? settings.favorites : local.favorites;
          applyRemote(
            {
              ...remote.document,
              options: savedOptions,
              favorites: savedFavorites,
            },
            { workspaceId: remote.id, version: remote.version },
            remote.aliases,
          );
          setOfferUpload(false);
          setConflictVersion(null);
        } catch {
          setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
        }
      })();
    });
  }, [applyRemote, flushNow, ready]);

  useEffect(() => {
    if (!ready) return;
    const doc = snapshot(state);
    const serialized = stableStringify(doc);
    const pending = baselineRef.current !== null && serialized !== baselineRef.current;
    try {
      writeLocalCache(localStorage, {
        ...doc,
        options: doc.options,
        sync: syncRef.current.workspaceId
          ? {
              workspaceId: syncRef.current.workspaceId,
              version: syncRef.current.version ?? 1,
              pending,
            }
          : undefined,
      });
    } catch {
      /* quota */
    }

    if (skipRemoteRef.current) {
      skipRemoteRef.current = false;
      baselineRef.current = serialized;
      setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "saved");
      return;
    }
    if (baselineRef.current === null) {
      baselineRef.current = serialized;
      return;
    }
    if (!pending) return;
    if (!userIdRef.current || !browserSupabase()) {
      setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "saved");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline");
      return;
    }
    setStatus("saving");
    const timer = setTimeout(() => {
      void flushNow();
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [flushNow, ready, state.activeLayerId, state.favorites, state.graphics, state.layers, state.options]);

  const uploadLocal = useCallback(async () => {
    const client = browserSupabase();
    if (!client || !userIdRef.current) return "Sign in before uploading.";
    const doc = snapshot(stateRef.current);
    try {
      setStatus("saving");
      const existing = await findWorkspaceByImportKey(client, BROWSER_IMPORT_KEY);
      let workspaceId: string;
      let version: number;
      if (existing) {
        const loaded = await loadWorkspace(client, existing.id);
        if (!loaded) return "The saved workspace could not be read.";
        workspaceId = loaded.id;
        version = loaded.version;
        aliasesRef.current = loaded.aliases;
      } else {
        const created = await createWorkspace(client, WORKSPACE_NAME, BROWSER_IMPORT_KEY);
        workspaceId = created.id;
        version = created.version;
        aliasesRef.current = new Map();
      }
      const result = await saveWorkspace(client, {
        workspaceId,
        expectedVersion: version,
        name: WORKSPACE_NAME,
        document: doc,
        aliases: aliasesRef.current,
      });
      if (!result.ok) {
        setStatus(result.conflict ? "conflict" : "error");
        if (result.conflict) setConflictVersion(result.version);
        return result.conflict ? "This map was saved somewhere else. Reload it, then import again." : result.error;
      }
      syncRef.current = { workspaceId, version: result.version };
      baselineRef.current = stableStringify(doc);
      await saveSettings(client, {
        options: doc.options as unknown as Record<string, unknown>,
        favorites: favoritesForSave(doc.favorites),
        lastWorkspaceId: workspaceId,
      });
      setOfferUpload(false);
      setConflictVersion(null);
      setStatus("saved");
      return null;
    } catch (error) {
      setStatus("error");
      return error instanceof Error ? error.message : "Upload failed.";
    }
  }, [favoritesForSave]);

  const reloadRemote = useCallback(async () => {
    const client = browserSupabase();
    const workspaceId = syncRef.current.workspaceId;
    if (!client || !workspaceId) return;
    const [remote, settings] = await Promise.all([loadWorkspace(client, workspaceId), loadSettings(client)]);
    if (!remote) return;
    applyRemote(
      { ...remote.document, options: settings?.options ?? {}, favorites: settings?.favorites ?? [] },
      { workspaceId: remote.id, version: remote.version },
      remote.aliases,
    );
    setConflictVersion(null);
    setStatus("saved");
  }, [applyRemote]);

  return {
    status,
    email,
    configured,
    offerUpload,
    conflictVersion,
    signIn: signInWithPassword,
    signUp: signUpWithPassword,
    signOut: async () => {
      await supabaseSignOut();
      userIdRef.current = null;
      syncRef.current = { workspaceId: null, version: null };
      setEmail(null);
      setOfferUpload(false);
    },
    uploadLocal,
    reloadRemote,
    dismissUpload: () => setOfferUpload(false),
  };
}
