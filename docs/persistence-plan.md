# Persistence plan

## Implemented

Supabase project **map-amft11** (`cevhucfgxifcoysrpvma`, `eu-central-1`, free plan, $0/month). The browser uses the publishable key in `.env.local`. The service role key is not in the repo and is not read by `src/`.

Migration `supabase/migrations/20261030121240_workspace_persistence.sql` is applied. Security advisors reported no issues. Performance advisors only reported unused indexes on empty tables; those indexes stay, because saves and ownership checks use `owner_id`, `workspace_id`, and `layer_id`. See [unused index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

RLS was checked with two temporary users inside a transaction that rolled back (no rows left behind). User A saw only the workspace named Alpha and one layer. Inserting a workspace owned by user B was rejected. Attaching a graphic to user B's layer was rejected.

Postgres kept the sample numbers exactly: `26.09869083945884`, `47.45698525542031`, `-151.8279716112679`, and `0.25`.

Auth in the app is **email + password** (Supabase Auth, not a custom session). A magic link can replace it later. New projects often require email confirmation before the first sign-in; that setting is in the Supabase Auth dashboard.

The seed file is `seed/localstorage-export.json` (5 layers, 29 graphics). `npm run import:local -- --dry-run` validates it. The script has **not** been run against the database.

### Run migrations on a fresh project

```bash
supabase link --project-ref cevhucfgxifcoysrpvma
supabase db push
```

Regenerate `src/persistence/database.types.ts` with:

```bash
supabase gen types typescript --project-id cevhucfgxifcoysrpvma > src/persistence/database.types.ts
```

### Run the import

Put `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (never `NEXT_PUBLIC_`). Then:

```bash
npm run import:local -- --dry-run
npm run import:local -- --email you@example.com
```

`--user-id` works instead of `--email`. Re-running updates the workspace whose `import_key` is `seed:localstorage-export`. In the app, a signed-in user can use **Import from this browser** (`import_key` `browser:military-map-v2`).

### Tests

```bash
npm test
```

Covers the row mapper (including `layer-new`, unknown fields, and coordinate tokens), the save/delete diff, and the seed file round-trip.

### Schema as applied

- `workspaces`: `id`, `owner_id`, `name`, `active_layer_id` (uuid, no foreign key), `version`, `import_key`, `created_at`, `updated_at`
- `layers`: uuid `id`, `workspace_id`, `legacy_id`, `name`, `visible`, `locked`, `sort_order`, `extra`
- `graphics`: uuid `id`, `workspace_id`, `layer_id`, `legacy_id`, symbol columns, `scale`/`rotation` numeric null, `coordinates` jsonb, `modifiers` jsonb, `extra`, `sort_order`
- `user_settings`: `user_id`, `options`, `favorites`, `last_workspace_id`, `updated_at`
- `save_workspace(...)` is `security invoker`. Signed-in users can only touch their own rows. The service role may pass `p_owner_id` for the CLI import.

No PostGIS column.

### Known limitations

- Map center, zoom, selection, undo, gallery chrome, and the MCOO overlay stay on this browser.
- Options and favorites follow the user, not each workspace.
- A second browser editing the same workspace gets a conflict instead of a merge. The bar says **Conflict** and offers **Reload saved map**.
- Offline edits stay in `military-map-v2` and sync on the next successful save of the whole workspace.
- `"layer-new"` remains the id inside the app and in localStorage. The database stores a uuid plus `legacy_id`.
- Autosave waits about 1.5 seconds. The status reads Saved, Saving, Offline, Conflict, or Not saved.

The sections below are the Step 0 investigation that led to this schema.

---


## Stack (detected)

| Piece | What the repo actually uses |
| --- | --- |
| App | Next.js 15 (`next dev --port 3000`), React 19, TypeScript. Single client page: `src/app/page.tsx` → `MapApp`. |
| Map | MapLibre GL (`maplibre-gl`). Coordinates are `[lng, lat]` / `[lon, lat]`, WGS84. |
| Symbols | `@armyc2.c5isr.renderer/mil-sym-ts-web` (MIL-STD-2525D / APP-6). Not the `milsymbol` package. |
| State | One React context + `useReducer` in `src/lib/store.tsx`. No Redux, no Zustand. |
| Tests | None. No test runner in `package.json`. |
| Auth | None. No Supabase client, no env files, no `supabase/` directory. |
| Supabase project | Not created for this app. The linked account has other projects (`life-app`, `fin-app`, and others). None of them is this map. This work needs a **new** project. Do not reuse those databases. |

## 1. localStorage

There is one key, owned by one module.

| Key | Module | Read | Write |
| --- | --- | --- | --- |
| `military-map-v2` | `src/lib/store.tsx` (`MapStoreProvider`) | On mount, `localStorage.getItem`, then `dispatch({ type: "hydrate" })` | After hydrate (`ready === true`), on every change to layers, graphics, active layer, options, or favorites |

No other `localStorage`, `sessionStorage`, or IndexedDB usage exists.

The saved payload is exactly:

```ts
{
  layers: MapLayer[];
  graphics: Graphic[];
  activeLayerId: string;
  options: ViewOptions;
  favorites: string[]; // catalog symbol ids, from CatalogSymbol.id
}
```

Broken JSON is ignored and the app keeps `initialState`. A quota failure on write is ignored. The write is synchronous, not debounced.

`MapStoreProvider` sets `ready` only after the read, so the empty starter state is not written over an existing save. That guard has to stay when a remote load is added. React Strict Mode mounts effects twice in development; load and save must tolerate that.

## 2. In-memory state vs the export

`MapState` in `src/lib/store.tsx` is larger than the saved document. Hydrate copies only the five persisted fields and clears undo (`past` / `future`).

### Persisted, and present in both the type and the export

Layers (`MapLayer`): `id`, `name`, `visible`, `locked`.

Graphics (`Graphic`): `id`, `layerId`, `name`, `renderer` (`"symbol"` \| `"generic"`), `kind` (`point` \| `line` \| `area` \| `pin` \| `text` \| `rect` \| `circle` \| `bean`), `basicId`, `affiliation` (`F` \| `H` \| `N` \| `U`), `status` (`P` \| `A`), `echelon`, `headquarters`, `taskForce`, `feint`, `color`, `scale?`, `rotation?`, `coordinates` (`[number, number][]`), `modifiers`.

`modifiers` keys, all strings: `uniqueDesignation`, `uniqueDesignation2`, `higherFormation`, `additionalInformation`, `staffComments`, `reinforcedReduced`, `quantity`, `type`, `dtg`, `altitudeDepth`, `direction`, `distance`, `azimuth`.

Options (`ViewOptions`): `standard` (`2525` \| `APP6`), `theme`, `hints`, `distanceUnit`, `angularUnit`, `geoFormat`, `mapType`, `brightness`, `hue`, `chroma`, `coordinateSearch`, `measure`, `cursorCoordinate`, `showScale`, `grid`, `symbolSize`, `symbolFill`, `symbolFrame`, `shadow`, `strokeWidth`.

`favorites`: `string[]`. Gallery favorites are catalog ids (`getBasicSymbolID()`), not graphic ids. The export's `favorites: []` matches the type.

`activeLayerId`: string. In the export it is the ECOA1 layer id.

### Used by the app, deliberately not in the export

These reset on reload today. They stay local. They are not columns.

From `MapState`: `selectedId`, `left`, `right`, `placing`, `draft`, `measurePts`, `past`, `future`, `infoOpen`, `cursor`, `query`, `gallerySection`, `galleryAffiliation`, `galleryEchelon`, `galleryStatus`, `galleryHeadquarters`, `galleryTaskForce`, `galleryFeint`, `galleryReinforced`, `openGroups`, `menu`, `clipboard`.

From `MapApp` (`useState`, not the store): map center/zoom, MCOO overlay on/off, movement class, ground condition, coordinate-search box. MapLibre's camera is not saved. Reloading restores symbols, not the viewport.

### In the export, not a separate code field

Nothing. Every persisted key is a field the store already reads. Field **order** varies (bean graphics put `scale` and `rotation` after `modifiers`). `JSON.parse` does not care. The mapper must not assume key order.

`scale` and `rotation` are optional on `Graphic`. New generic drawings omit them until a scale or rotate action. Beans in the export have both (`scale: 0.25`, rotations such as `-151.8279716112679`). Columns must allow null, and a missing value must stay missing on the way back so we do not invent `0`.

### Hydrate is not a pure parse

`restoreGraphic` (store) spreads the graphic, coerces `feint` with `Boolean`, and fills `modifiers.distance` / `modifiers.azimuth` from the symbol contract **only when those keys are absent**. This export includes both keys (often `""`) and `feint: false` on every graphic, so hydrate does not change values.

The mapper must keep the full modifiers object, including empty strings. Dropping a missing-looking key would make the next hydrate invent a contract default, and the symbol would draw differently.

Unknown keys on a graphic survive today because `restoreGraphic` spreads `...graphic` and the save effect `JSON.stringify`s the object. Unknown keys on a layer survive because layers are stored as-is. Unknown top-level keys are dropped, because hydrate copies an explicit field list. The database should keep unknown layer and graphic fields (see `extra` below).

### Id quirk

`initialState` uses a starter layer whose id is the literal `"layer-new"` (`src/lib/store.tsx`). Later layers and every graphic use `crypto.randomUUID()`. The export's first layer is that starter, renamed to `"ZO"`. The other four layer ids and all 29 graphic ids are UUID-shaped. `activeLayerId` in the export is already a UUID (ECOA1).

A global `text` primary key would let only one row in the whole table have id `"layer-new"`. UUID primary keys plus `legacy_id` are the right fit.

Array order is the draw and panel order. There is no `sortOrder` field. Persistence must store the index and restore it. Later graphics paint above earlier ones.

## 3. What "session" means here

Both are missing today.

| Meaning | Today | Target |
| --- | --- | --- |
| Logged-in user | No auth. Anyone who can open the browser can edit the local map. | Supabase Auth. Built-in session persistence and refresh. `onAuthStateChange`. No custom user table, no custom password store. |
| Map workspace | The `military-map-v2` blob in that browser only. | Rows owned by `auth.users.id`, loaded after login via `user_settings.last_workspace_id`. |

Unauthenticated use stays local-only. Login does not wipe local work. The first successful login offers to upload the local workspace.

Options and favorites are one blob per browser today, not per layer. The proposed `user_settings` row matches that: view preferences follow the user, not each workspace. A later workspace switcher would share options until we move them. v1 does not add a workspace picker. `listWorkspaces()` exists for the data layer; the map UI keeps editing the last workspace.

## 4. Export file

`seed/localstorage-export.json` is **not in the repo**. The JSON in the task message is the export. Counts from that JSON:

| Layer | Id | Graphics |
| --- | --- | --- |
| ZO | `layer-new` (not a UUID) | 3 (1 line, 2 points) |
| ZRI | `6bfebbea-e20b-4573-a0c5-0ef8252cfebf` | 0 |
| ZII | `e911a6c5-b2fe-4655-ba15-4b0f09d908c1` | 0 |
| ECOA1 | `589b79f2-e537-4a7c-84fd-b360cc104791` (active) | 26 (4 beans, 2 lines, 20 points) |
| ECOA2 | `53196a60-0e9f-4aa8-bd4c-ea0fbdf7e13e` | 0 |
| **Total** | **5 layers** | **29 graphics** |

`options.standard` is `"APP6"`, `mapType` is `"satellite"`, `geoFormat` is `"mgrs"`, `grid` is true. Those differ from `DEFAULT_OPTIONS` (`2525`, `terrain`, `decimal`, grid off). Hydrate merges `{ ...DEFAULT_OPTIONS, ...saved.options }`, so the saved values win. A round-trip must return the saved options, not the defaults.

No graphic in this file has a key outside `Graphic`. No layer has a key outside `MapLayer`. `extra` will be `{}` for this file and is still required so a future field is not dropped.

The seed file will be added when implementation starts, copied from the provided JSON, not rewritten by hand. The import script will not be pointed at a live database until you confirm.

## 5. Schema (adjusted)

The proposed tables stay. Adjustments below are from the findings, not a new model.

### `workspaces`

- `id uuid pk default gen_random_uuid()`
- `owner_id uuid not null references auth.users(id) on delete cascade`
- `name text not null`
- `active_layer_id uuid null` — **no foreign key**. `workspaces` ↔ `layers` would be a cycle (`layers.workspace_id` → `workspaces`, `workspaces.active_layer_id` → `layers`). The save function sets `active_layer_id` only when that layer belongs to the workspace, or null.
- `version int not null default 1` — optimistic lock
- `import_key text null` — stable id for the CLI and the in-app importer (`seed:localstorage-export`, `browser:military-map-v2`). Unique `(owner_id, import_key)` where `import_key` is not null, so a re-run updates one workspace instead of inserting another. App-created workspaces leave it null.
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()` — trigger

### `layers`

- `id uuid pk` — new UUID when the app id is not a UUID; otherwise the original id
- `workspace_id uuid not null references workspaces(id) on delete cascade`
- `legacy_id text null` — original id, including `"layer-new"`
- `name text not null`
- `visible boolean not null`
- `locked boolean not null`
- `sort_order int not null`
- `extra jsonb not null default '{}'` — **added**. Unknown layer fields have nowhere else to go. This export has none.
- unique `(workspace_id, legacy_id)` where `legacy_id` is not null, so remap is stable across re-imports

### `graphics`

- `id uuid pk` — same rule as layers
- `workspace_id uuid not null references workspaces(id) on delete cascade` (denormalized so RLS and deletes do not depend on a join alone; the save function checks it matches `layers.workspace_id`)
- `layer_id uuid not null references layers(id) on delete cascade`
- `legacy_id text null` — **added**. This file's graphic ids are all UUIDs, so it stays null. The same remap covers a future non-UUID graphic id.
- mapped columns: `name`, `renderer`, `kind`, `basic_id`, `affiliation`, `status`, `echelon`, `headquarters`, `task_force`, `feint`, `color`, `scale numeric null`, `rotation numeric null`, `coordinates jsonb not null`, `modifiers jsonb not null`, `sort_order int not null`
- `extra jsonb not null default '{}'`

`scale` / `rotation` are `numeric`, not `float4` / `float8`, so Postgres does not round to binary float. The mapper will test that `JSON.stringify` of the value read back equals the original token (for example `-151.8279716112679` and the 10-vertex FLOT coordinates). If `jsonb` or `numeric` rewrites any token, those columns switch to `text` holding the original JSON literal before any live import.

Coordinates stay `[lon, lat]`. No axis swap. No `toFixed`.

### `user_settings`

- `user_id uuid pk references auth.users(id) on delete cascade`
- `options jsonb not null default '{}'`
- `favorites jsonb not null default '[]'`
- `last_workspace_id uuid null references workspaces(id) on delete set null`
- `updated_at timestamptz not null default now()`

### Not in v1

PostGIS `geom` is **not** added. The map never queries spatially on the server; MapLibre filters and draws on the client. A generated geometry column would add an extension and a second source of coordinates to keep in sync. Say if you want bbox queries later.

### Row Level Security

RLS enabled on all four tables. No policy uses `user_metadata` (users can edit that claim).

- `workspaces`: `owner_id = auth.uid()` for select, insert, update, delete. Insert `with check` forces `owner_id = auth.uid()`.
- `layers` and `graphics`: select/insert/update/delete only when a workspace row with that `workspace_id` is owned by `auth.uid()`. Update policies include a matching `using` and `with check` (Postgres requires a select policy or the update changes nothing).
- `user_settings`: `user_id = auth.uid()` for all commands.

`anon` has no policies. Unauthenticated clients cannot read or write these tables.

### Save function

One Postgres function, `public.save_workspace(...)`, **`security invoker`**. It runs as the signed-in user, so RLS still applies. It is not `security definer` (a definer function in `public` would bypass RLS).

In one transaction it:

1. Updates the workspace `where id = $id and owner_id = auth.uid() and version = $expected`, increments `version`, sets `active_layer_id`, `name`. If zero rows, it returns a conflict payload and changes nothing.
2. Upserts layers and graphics that are in the payload.
3. Deletes layers and graphics that belong to the workspace but are absent from the payload.

The client debounces 1–2 s, then calls this RPC. Diffing (what to upsert vs delete) can live in the client and be covered by unit tests; the function still applies the full set inside the transaction so a crash cannot leave a half-deleted layer.

Grants: `execute` for `authenticated` only.

### Indexes

- `workspaces (owner_id)`
- `layers (workspace_id)`, `graphics (workspace_id)`, `graphics (layer_id)`
- unique indexes noted above

### Types

`supabase gen types typescript` into something like `src/persistence/database.types.ts`. The app mapper does not import row types into components.

## 6. Data access

New module `src/persistence/`. Components and `MapCanvas` do not import the Supabase client.

| Function | Role |
| --- | --- |
| `loadWorkspace(id)` | Workspace + layers + graphics ordered by `sort_order`, mapped to the persisted app shape. |
| `saveWorkspace(state, expectedVersion)` | Debounced caller. Returns `{ version }` or `{ conflict }`. |
| `listWorkspaces()` | id, name, updated_at for the signed-in user. |
| `loadSettings()` / `saveSettings()` | options, favorites, `last_workspace_id`. |

Mappers live in one file: camelCase app objects ↔ snake_case rows. Unknown graphic/layer keys go to `extra` and are spread back on read. Round-trip test: app state → rows → app state is deep-equal, including coordinate tokens and modifier keys.

`src/lib/store.tsx` keeps the reducer and the editing actions. The provider:

1. Writes `military-map-v2` first (current behavior, still the offline cache).
2. If there is a session and the browser is online, debounces a remote save.
3. Exposes a small status the shell can show: **Saving**, **Saved**, **Offline**, **Conflict**.

Conflict does not overwrite. The UI tells the user the workspace changed elsewhere and offers reload. No silent last-write-wins.

Map drawing, hit testing, and symbol editing stay as they are. The status is the only new UI in this step.

## 7. Auth

Not built until you pick one:

- **Email + password**, or
- **Email magic link** (needs a redirect URL such as `/auth/callback` on this Next app)

Client: `@supabase/supabase-js` in the browser, session in the client's own storage (not `military-map-v2`). Listen to `onAuthStateChange`. On sign-in, `loadSettings()`, then `loadWorkspace(last_workspace_id)` if set, and `hydrate`. If the user has local layers/graphics and no server workspace yet, ask before uploading.

Env (names only, values not committed):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable / anon key only)
- `SUPABASE_SERVICE_ROLE_KEY` — CLI import script only, never `NEXT_PUBLIC_`, never imported by `src/`

`.env.example` lists the three. `.gitignore` already ignores `.env`.

## 8. Import

`scripts/import-localstorage.ts` (run with a TypeScript runner — see dependencies):

1. Read `seed/localstorage-export.json` or a path argument.
2. Validate with zod. Unknown keys are logged and kept (`extra`), not stripped.
3. Remap non-UUID ids to new UUIDs, store the original in `legacy_id`, rewrite `graphics.layerId` and `activeLayerId`. A second run reuses the row found by `(workspace, legacy_id)` so `"layer-new"` does not change UUID every time.
4. Upsert one workspace for `--email` or `--user-id`, layers in file order, then graphics, then `user_settings` (`options`, `favorites`, `last_workspace_id`).
5. `--dry-run` prints the plan and writes nothing. Re-run without dry-run updates the same `import_key` workspace.
6. Print layer names, graphic counts per layer, and a DB count check. Expected: 5 layers, 29 graphics.

The script may use the service role. The in-app action **Import from this browser** runs the same remap and upsert through the persistence module as the signed-in user (RLS, no service role). Source is the current `military-map-v2` value.

## 9. Dependencies to add (none installed yet)

| Package | Why |
| --- | --- |
| `@supabase/supabase-js` | Client and script. Required. |
| `zod` | Import validation, as in the task. Small. |
| `vitest` | Mapper, remap, and save-diff tests. No runner exists today. |

No PostGIS client, no auth UI kit, no `@supabase/ssr` unless magic-link cookies turn out to need it. The store is already a client component; the browser client is enough for email+password.

## 10. Later commit slices (after you confirm)

1. Migration + generated types.
2. Persistence mappers, diff, tests.
3. Wire the store: local write, debounced sync, status indicator.
4. Auth and the upload prompt.
5. Seed file, import script, in-app import.
6. Update this doc with the applied schema, migration commands, import commands, and limitations.

I will not apply migrations, create a Supabase project, or run the import until you say so.

## 11. Known limitations (expected)

- Viewport, selection, undo, gallery chrome, and the MCOO overlay stay on the device.
- Options and favorites are per user, shared across that user's workspaces.
- Two browsers editing at once: the second save surfaces a conflict instead of merging.
- Offline edits sync on the next successful save of the whole workspace. There is no operation log.
- `"layer-new"` cannot be a primary key. After the first sync, the in-memory layer id becomes the new UUID (legacy id kept only in the database). Graphics that pointed at it are rewritten in the same save.
- Number fidelity depends on the `numeric` / `jsonb` round-trip test. If it fails, those fields move to `text` before import.

## Decisions needed before Step 1

1. **Auth:** email + password, or magic link?
2. **PostGIS:** leave it out (recommended), or add a generated `geom`?
3. **New Supabase project** for this app (recommended). Confirm and I will create it when you release Step 1. I will not use `life-app` or the other existing projects.
4. **Dependencies:** approve `@supabase/supabase-js`, `zod`, and `vitest`.
5. **Schema adjustments:** `layers.extra`, `graphics.legacy_id`, `workspaces.import_key`, and `active_layer_id` without a foreign key. Confirm or tell me to stick to the original column list.
