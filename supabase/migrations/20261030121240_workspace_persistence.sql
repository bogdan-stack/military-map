-- Map workspace persistence. One owner per workspace. Layers and graphics
-- cascade with the workspace. active_layer_id is not a foreign key: that
-- would cycle with layers.workspace_id. The save function checks it instead.
-- No PostGIS. Coordinates stay jsonb [lon, lat] so the map code is unchanged.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon;
grant execute on function public.set_updated_at() to authenticated, service_role;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  active_layer_id uuid null,
  version integer not null default 1,
  import_key text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_version_positive check (version > 0)
);

create unique index workspaces_owner_import_key_uidx
  on public.workspaces (owner_id, import_key)
  where import_key is not null;

create index workspaces_owner_id_idx on public.workspaces (owner_id);

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create table public.layers (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  legacy_id text null,
  name text not null default '',
  visible boolean not null default true,
  locked boolean not null default false,
  sort_order integer not null default 0,
  extra jsonb not null default '{}'::jsonb,
  constraint layers_extra_object check (jsonb_typeof(extra) = 'object')
);

create index layers_workspace_id_idx on public.layers (workspace_id);

create unique index layers_workspace_legacy_id_uidx
  on public.layers (workspace_id, legacy_id)
  where legacy_id is not null;

create table public.graphics (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  layer_id uuid not null references public.layers (id) on delete cascade,
  legacy_id text null,
  name text not null default '',
  renderer text not null default '',
  kind text not null default '',
  basic_id text not null default '',
  affiliation text not null default '',
  status text not null default '',
  echelon text not null default '',
  headquarters boolean not null default false,
  task_force boolean not null default false,
  feint boolean not null default false,
  color text not null default '',
  scale numeric null,
  rotation numeric null,
  coordinates jsonb not null default '[]'::jsonb,
  modifiers jsonb not null default '{}'::jsonb,
  extra jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  constraint graphics_coordinates_array check (jsonb_typeof(coordinates) = 'array'),
  constraint graphics_modifiers_object check (jsonb_typeof(modifiers) = 'object'),
  constraint graphics_extra_object check (jsonb_typeof(extra) = 'object')
);

create index graphics_workspace_id_idx on public.graphics (workspace_id);
create index graphics_layer_id_idx on public.graphics (layer_id);

create unique index graphics_workspace_legacy_id_uidx
  on public.graphics (workspace_id, legacy_id)
  where legacy_id is not null;

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  options jsonb not null default '{}'::jsonb,
  favorites jsonb not null default '[]'::jsonb,
  last_workspace_id uuid null references public.workspaces (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint user_settings_options_object check (jsonb_typeof(options) = 'object'),
  constraint user_settings_favorites_array check (jsonb_typeof(favorites) = 'array')
);

create index user_settings_last_workspace_id_idx
  on public.user_settings (last_workspace_id);

create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.workspaces enable row level security;
alter table public.layers enable row level security;
alter table public.graphics enable row level security;
alter table public.user_settings enable row level security;

create policy workspaces_select on public.workspaces
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy workspaces_insert on public.workspaces
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy workspaces_update on public.workspaces
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy workspaces_delete on public.workspaces
  for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy layers_select on public.layers
  for select to authenticated
  using (
    exists (
      select 1 from public.workspaces w
      where w.id = layers.workspace_id
        and w.owner_id = (select auth.uid())
    )
  );

create policy layers_insert on public.layers
  for insert to authenticated
  with check (
    exists (
      select 1 from public.workspaces w
      where w.id = layers.workspace_id
        and w.owner_id = (select auth.uid())
    )
  );

create policy layers_update on public.layers
  for update to authenticated
  using (
    exists (
      select 1 from public.workspaces w
      where w.id = layers.workspace_id
        and w.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.workspaces w
      where w.id = layers.workspace_id
        and w.owner_id = (select auth.uid())
    )
  );

create policy layers_delete on public.layers
  for delete to authenticated
  using (
    exists (
      select 1 from public.workspaces w
      where w.id = layers.workspace_id
        and w.owner_id = (select auth.uid())
    )
  );

create policy graphics_select on public.graphics
  for select to authenticated
  using (
    exists (
      select 1 from public.workspaces w
      where w.id = graphics.workspace_id
        and w.owner_id = (select auth.uid())
    )
  );

create policy graphics_insert on public.graphics
  for insert to authenticated
  with check (
    exists (
      select 1 from public.workspaces w
      where w.id = graphics.workspace_id
        and w.owner_id = (select auth.uid())
    )
    and exists (
      select 1 from public.layers l
      where l.id = graphics.layer_id
        and l.workspace_id = graphics.workspace_id
    )
  );

create policy graphics_update on public.graphics
  for update to authenticated
  using (
    exists (
      select 1 from public.workspaces w
      where w.id = graphics.workspace_id
        and w.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.workspaces w
      where w.id = graphics.workspace_id
        and w.owner_id = (select auth.uid())
    )
    and exists (
      select 1 from public.layers l
      where l.id = graphics.layer_id
        and l.workspace_id = graphics.workspace_id
    )
  );

create policy graphics_delete on public.graphics
  for delete to authenticated
  using (
    exists (
      select 1 from public.workspaces w
      where w.id = graphics.workspace_id
        and w.owner_id = (select auth.uid())
    )
  );

create policy user_settings_select on public.user_settings
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy user_settings_insert on public.user_settings
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      last_workspace_id is null
      or exists (
        select 1 from public.workspaces w
        where w.id = last_workspace_id
          and w.owner_id = (select auth.uid())
      )
    )
  );

create policy user_settings_update on public.user_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      last_workspace_id is null
      or exists (
        select 1 from public.workspaces w
        where w.id = last_workspace_id
          and w.owner_id = (select auth.uid())
      )
    )
  );

create policy user_settings_delete on public.user_settings
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.workspaces from public, anon;
revoke all on table public.layers from public, anon;
revoke all on table public.graphics from public, anon;
revoke all on table public.user_settings from public, anon;

grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.layers to authenticated;
grant select, insert, update, delete on public.graphics to authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;

-- Full snapshot save. security invoker so RLS still applies to signed-in users.
-- service_role (CLI import only) may pass p_owner_id because auth.uid() is null
-- for that key. Authenticated callers cannot impersonate: their uid wins.
create or replace function public.save_workspace(
  p_workspace_id uuid,
  p_expected_version integer,
  p_name text,
  p_active_layer_id uuid,
  p_layers jsonb,
  p_graphics jsonb,
  p_owner_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner uuid;
  v_version integer;
  v_layer_count integer;
  v_graphic_count integer;
begin
  if auth.uid() is not null then
    v_owner := auth.uid();
  elsif auth.role() = 'service_role' then
    v_owner := p_owner_id;
    if v_owner is null then
      return jsonb_build_object('ok', false, 'error', 'owner_required');
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  if jsonb_typeof(p_layers) is distinct from 'array'
     or jsonb_typeof(p_graphics) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;

  select count(*) into v_layer_count from jsonb_array_elements(p_layers);
  select count(distinct item->>'id') into v_graphic_count from jsonb_array_elements(p_layers) item;
  if v_layer_count is distinct from v_graphic_count then
    return jsonb_build_object('ok', false, 'error', 'duplicate_layer');
  end if;

  select count(*) into v_layer_count from jsonb_array_elements(p_graphics);
  select count(distinct item->>'id') into v_graphic_count from jsonb_array_elements(p_graphics) item;
  if v_layer_count is distinct from v_graphic_count then
    return jsonb_build_object('ok', false, 'error', 'duplicate_graphic');
  end if;

  if p_active_layer_id is not null and not exists (
    select 1 from jsonb_array_elements(p_layers) layer
    where (layer->>'id')::uuid = p_active_layer_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'active_layer_missing');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_graphics) graphic
    where not exists (
      select 1 from jsonb_array_elements(p_layers) layer
      where (layer->>'id')::uuid = (graphic->>'layer_id')::uuid
    )
  ) then
    return jsonb_build_object('ok', false, 'error', 'graphic_layer_missing');
  end if;

  select version into v_version
  from public.workspaces
  where id = p_workspace_id
    and owner_id = v_owner
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_version is distinct from p_expected_version then
    return jsonb_build_object('ok', false, 'conflict', true, 'version', v_version);
  end if;

  update public.workspaces
  set name = coalesce(nullif(p_name, ''), name),
      active_layer_id = p_active_layer_id,
      version = version + 1
  where id = p_workspace_id
    and owner_id = v_owner
    and version = p_expected_version
  returning version into v_version;

  if v_version is null then
    return jsonb_build_object('ok', false, 'conflict', true);
  end if;

  insert into public.layers (
    id, workspace_id, legacy_id, name, visible, locked, sort_order, extra
  )
  select
    (layer->>'id')::uuid,
    p_workspace_id,
    nullif(layer->>'legacy_id', ''),
    coalesce(layer->>'name', ''),
    coalesce((layer->>'visible')::boolean, true),
    coalesce((layer->>'locked')::boolean, false),
    coalesce((layer->>'sort_order')::integer, 0),
    case
      when jsonb_typeof(layer->'extra') = 'object' then layer->'extra'
      else '{}'::jsonb
    end
  from jsonb_array_elements(p_layers) layer
  on conflict (id) do update set
    workspace_id = excluded.workspace_id,
    legacy_id = excluded.legacy_id,
    name = excluded.name,
    visible = excluded.visible,
    locked = excluded.locked,
    sort_order = excluded.sort_order,
    extra = excluded.extra;

  insert into public.graphics (
    id, workspace_id, layer_id, legacy_id, name, renderer, kind, basic_id,
    affiliation, status, echelon, headquarters, task_force, feint, color,
    scale, rotation, coordinates, modifiers, extra, sort_order
  )
  select
    (graphic->>'id')::uuid,
    p_workspace_id,
    (graphic->>'layer_id')::uuid,
    nullif(graphic->>'legacy_id', ''),
    coalesce(graphic->>'name', ''),
    coalesce(graphic->>'renderer', ''),
    coalesce(graphic->>'kind', ''),
    coalesce(graphic->>'basic_id', ''),
    coalesce(graphic->>'affiliation', ''),
    coalesce(graphic->>'status', ''),
    coalesce(graphic->>'echelon', ''),
    coalesce((graphic->>'headquarters')::boolean, false),
    coalesce((graphic->>'task_force')::boolean, false),
    coalesce((graphic->>'feint')::boolean, false),
    coalesce(graphic->>'color', ''),
    case
      when graphic->'scale' is null or jsonb_typeof(graphic->'scale') = 'null' then null
      else (graphic->>'scale')::numeric
    end,
    case
      when graphic->'rotation' is null or jsonb_typeof(graphic->'rotation') = 'null' then null
      else (graphic->>'rotation')::numeric
    end,
    case
      when jsonb_typeof(graphic->'coordinates') = 'array' then graphic->'coordinates'
      else '[]'::jsonb
    end,
    case
      when jsonb_typeof(graphic->'modifiers') = 'object' then graphic->'modifiers'
      else '{}'::jsonb
    end,
    case
      when jsonb_typeof(graphic->'extra') = 'object' then graphic->'extra'
      else '{}'::jsonb
    end,
    coalesce((graphic->>'sort_order')::integer, 0)
  from jsonb_array_elements(p_graphics) graphic
  on conflict (id) do update set
    workspace_id = excluded.workspace_id,
    layer_id = excluded.layer_id,
    legacy_id = excluded.legacy_id,
    name = excluded.name,
    renderer = excluded.renderer,
    kind = excluded.kind,
    basic_id = excluded.basic_id,
    affiliation = excluded.affiliation,
    status = excluded.status,
    echelon = excluded.echelon,
    headquarters = excluded.headquarters,
    task_force = excluded.task_force,
    feint = excluded.feint,
    color = excluded.color,
    scale = excluded.scale,
    rotation = excluded.rotation,
    coordinates = excluded.coordinates,
    modifiers = excluded.modifiers,
    extra = excluded.extra,
    sort_order = excluded.sort_order;

  delete from public.graphics g
  where g.workspace_id = p_workspace_id
    and not exists (
      select 1 from jsonb_array_elements(p_graphics) item
      where (item->>'id')::uuid = g.id
    );

  delete from public.layers l
  where l.workspace_id = p_workspace_id
    and not exists (
      select 1 from jsonb_array_elements(p_layers) item
      where (item->>'id')::uuid = l.id
    );

  return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

revoke all on function public.save_workspace(uuid, integer, text, uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.save_workspace(uuid, integer, text, uuid, jsonb, jsonb, uuid) to authenticated, service_role;
