-- Shop-level catalog tree + shelf presentation sync.
-- Live feed for multi-device folders/shelves. NOT shop_cloud_snapshots
-- (snapshots remain backup/recovery only).

create table if not exists public.shop_catalog_nodes (
  shop_id uuid not null references public.shops (id) on delete cascade,
  id text not null,
  parent_id text,
  name text not null,
  legacy_shelf_key text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (shop_id, id)
);

create index if not exists shop_catalog_nodes_shop_updated_idx
  on public.shop_catalog_nodes (shop_id, updated_at);

create index if not exists shop_catalog_nodes_shop_deleted_idx
  on public.shop_catalog_nodes (shop_id, deleted_at)
  where deleted_at is not null;

create table if not exists public.shop_catalog_shelf_layout (
  shop_id uuid not null references public.shops (id) on delete cascade,
  shelf_key text not null,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (shop_id, shelf_key)
);

create index if not exists shop_catalog_shelf_layout_shop_updated_idx
  on public.shop_catalog_shelf_layout (shop_id, updated_at);

create table if not exists public.shop_catalog_meta (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  catalog_hierarchy_enabled boolean not null default false,
  hierarchy_updated_at timestamptz not null default 'epoch'::timestamptz,
  pinned_revisions jsonb not null default '{}'::jsonb,
  pinned_keys jsonb not null default '[]'::jsonb,
  pinned_updated_at timestamptz not null default 'epoch'::timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.shop_catalog_nodes enable row level security;
alter table public.shop_catalog_shelf_layout enable row level security;
alter table public.shop_catalog_meta enable row level security;

drop policy if exists shop_catalog_nodes_select on public.shop_catalog_nodes;
create policy shop_catalog_nodes_select
  on public.shop_catalog_nodes for select
  using (public.user_is_cashier_or_above (shop_id));

drop policy if exists shop_catalog_nodes_write on public.shop_catalog_nodes;
create policy shop_catalog_nodes_write
  on public.shop_catalog_nodes for all
  using (public.user_can_manage_shop (shop_id))
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists shop_catalog_shelf_layout_select on public.shop_catalog_shelf_layout;
create policy shop_catalog_shelf_layout_select
  on public.shop_catalog_shelf_layout for select
  using (public.user_is_cashier_or_above (shop_id));

drop policy if exists shop_catalog_shelf_layout_write on public.shop_catalog_shelf_layout;
create policy shop_catalog_shelf_layout_write
  on public.shop_catalog_shelf_layout for all
  using (public.user_can_manage_shop (shop_id))
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists shop_catalog_meta_select on public.shop_catalog_meta;
create policy shop_catalog_meta_select
  on public.shop_catalog_meta for select
  using (public.user_is_cashier_or_above (shop_id));

drop policy if exists shop_catalog_meta_write on public.shop_catalog_meta;
create policy shop_catalog_meta_write
  on public.shop_catalog_meta for all
  using (public.user_can_manage_shop (shop_id))
  with check (public.user_can_manage_shop (shop_id));

-- ---------- Push catalog (node-level merge; never whole-array replace) ----------
create or replace function public.shop_push_catalog (
  p_shop_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_node jsonb;
  v_layout jsonb;
  v_tomb jsonb;
  v_id text;
  v_updated timestamptz;
  v_deleted timestamptz;
  v_existing_updated timestamptz;
  v_existing_deleted timestamptz;
  v_rejected text[] := '{}';
  v_hier boolean;
  v_hier_at timestamptz;
  v_pin_at timestamptz;
  v_incoming_revs jsonb;
  v_stored_revs jsonb;
  v_key text;
  v_in_rev jsonb;
  v_st_rev jsonb;
  v_merged_revs jsonb;
  v_pin_keys jsonb;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  insert into public.shop_catalog_meta (shop_id)
  values (p_shop_id)
  on conflict (shop_id) do nothing;

  for v_node in
    select value
    from jsonb_array_elements (coalesce (p_payload -> 'nodes', '[]'::jsonb))
  loop
    v_id := nullif (trim (v_node ->> 'id'), '');
    if v_id is null then
      continue;
    end if;
    v_updated := coalesce (nullif (v_node ->> 'updated_at', '')::timestamptz, now ());
    v_deleted := nullif (v_node ->> 'deleted_at', '')::timestamptz;

    select n.updated_at, n.deleted_at
      into v_existing_updated, v_existing_deleted
    from public.shop_catalog_nodes n
    where n.shop_id = p_shop_id
      and n.id = v_id;

    if v_deleted is not null then
      if v_existing_updated is null then
        insert into public.shop_catalog_nodes (
          shop_id, id, parent_id, name, legacy_shelf_key, sort_order,
          created_at, updated_at, deleted_at
        )
        values (
          p_shop_id,
          v_id,
          nullif (trim (v_node ->> 'parent_id'), ''),
          coalesce (nullif (trim (v_node ->> 'name'), ''), v_id),
          coalesce (nullif (trim (v_node ->> 'legacy_shelf_key'), ''), v_id),
          coalesce ((v_node ->> 'sort_order')::integer, 0),
          coalesce (nullif (v_node ->> 'created_at', '')::timestamptz, v_updated),
          v_updated,
          v_deleted
        );
      elsif v_existing_deleted is not null then
        if v_deleted >= v_existing_deleted then
          update public.shop_catalog_nodes
          set deleted_at = v_deleted,
              updated_at = greatest (updated_at, v_updated)
          where shop_id = p_shop_id
            and id = v_id;
        end if;
      else
        -- Tombstone wins over a live row of the same id (no resurrection).
        update public.shop_catalog_nodes
        set deleted_at = v_deleted,
            updated_at = greatest (updated_at, v_updated)
        where shop_id = p_shop_id
          and id = v_id;
      end if;
      continue;
    end if;

    -- Live upsert. Tombstone always wins — never resurrect a deleted id.
    if v_existing_deleted is not null then
      v_rejected := array_append (v_rejected, v_id);
      continue;
    end if;

    if v_existing_updated is null then
      insert into public.shop_catalog_nodes (
        shop_id, id, parent_id, name, legacy_shelf_key, sort_order,
        created_at, updated_at, deleted_at
      )
      values (
        p_shop_id,
        v_id,
        nullif (trim (v_node ->> 'parent_id'), ''),
        coalesce (nullif (trim (v_node ->> 'name'), ''), v_id),
        coalesce (nullif (trim (v_node ->> 'legacy_shelf_key'), ''), v_id),
        coalesce ((v_node ->> 'sort_order')::integer, 0),
        coalesce (nullif (v_node ->> 'created_at', '')::timestamptz, v_updated),
        v_updated,
        null
      );
    elsif v_updated >= v_existing_updated then
      update public.shop_catalog_nodes
      set
        parent_id = nullif (trim (v_node ->> 'parent_id'), ''),
        name = coalesce (nullif (trim (v_node ->> 'name'), ''), name),
        legacy_shelf_key = coalesce (nullif (trim (v_node ->> 'legacy_shelf_key'), ''), legacy_shelf_key),
        sort_order = coalesce ((v_node ->> 'sort_order')::integer, sort_order),
        updated_at = v_updated,
        deleted_at = null
      where shop_id = p_shop_id
        and id = v_id;
    end if;
  end loop;

  for v_layout in
    select value
    from jsonb_array_elements (coalesce (p_payload -> 'layout', '[]'::jsonb))
  loop
    v_id := nullif (trim (v_layout ->> 'shelf_key'), '');
    if v_id is null then
      continue;
    end if;
    v_updated := coalesce (nullif (v_layout ->> 'updated_at', '')::timestamptz, now ());
    v_deleted := nullif (v_layout ->> 'deleted_at', '')::timestamptz;

    select l.updated_at, l.deleted_at
      into v_existing_updated, v_existing_deleted
    from public.shop_catalog_shelf_layout l
    where l.shop_id = p_shop_id
      and l.shelf_key = v_id;

    if v_deleted is not null then
      if v_existing_updated is null then
        insert into public.shop_catalog_shelf_layout (shop_id, shelf_key, config, updated_at, deleted_at)
        values (p_shop_id, v_id, coalesce (v_layout -> 'config', '{}'::jsonb), v_updated, v_deleted);
      elsif v_existing_deleted is null or v_deleted >= v_existing_deleted then
        if v_existing_deleted is not null or v_deleted >= coalesce (v_existing_updated, v_deleted) then
          update public.shop_catalog_shelf_layout
          set deleted_at = v_deleted,
              updated_at = greatest (updated_at, v_updated)
          where shop_id = p_shop_id
            and shelf_key = v_id;
        end if;
      end if;
      continue;
    end if;

    if v_existing_deleted is not null then
      continue;
    end if;

    if v_existing_updated is null then
      insert into public.shop_catalog_shelf_layout (shop_id, shelf_key, config, updated_at, deleted_at)
      values (
        p_shop_id,
        v_id,
        coalesce (v_layout -> 'config', '{}'::jsonb),
        v_updated,
        null
      );
    elsif v_updated >= v_existing_updated then
      update public.shop_catalog_shelf_layout
      set config = coalesce (v_layout -> 'config', config),
          updated_at = v_updated,
          deleted_at = null
      where shop_id = p_shop_id
        and shelf_key = v_id;
    end if;
  end loop;

  v_hier := (p_payload ->> 'catalog_hierarchy_enabled')::boolean;
  v_hier_at := nullif (p_payload ->> 'hierarchy_updated_at', '')::timestamptz;
  if v_hier is not null and v_hier_at is not null then
    update public.shop_catalog_meta
    set
      catalog_hierarchy_enabled = case
        when v_hier_at >= hierarchy_updated_at then v_hier
        else catalog_hierarchy_enabled
      end,
      hierarchy_updated_at = greatest (hierarchy_updated_at, v_hier_at),
      updated_at = now (),
      updated_by = v_uid
    where shop_id = p_shop_id;
  end if;

  v_incoming_revs := coalesce (p_payload -> 'pinned_revisions', '{}'::jsonb);
  if jsonb_typeof (v_incoming_revs) = 'object' then
    select pinned_revisions into v_stored_revs
    from public.shop_catalog_meta
    where shop_id = p_shop_id;
    v_stored_revs := coalesce (v_stored_revs, '{}'::jsonb);
    v_merged_revs := v_stored_revs;

    for v_key in
      select distinct k
      from (
        select jsonb_object_keys (v_incoming_revs) as k
        union
        select jsonb_object_keys (v_stored_revs) as k
      ) keys
    loop
      v_in_rev := v_incoming_revs -> v_key;
      v_st_rev := v_stored_revs -> v_key;
      if v_in_rev is null then
        continue;
      end if;
      if v_st_rev is null
        or coalesce (nullif (v_in_rev ->> 'updatedAt', '')::timestamptz, 'epoch'::timestamptz)
           >= coalesce (nullif (v_st_rev ->> 'updatedAt', '')::timestamptz, 'epoch'::timestamptz)
      then
        v_merged_revs := jsonb_set (v_merged_revs, array[v_key], v_in_rev, true);
      end if;
    end loop;

    v_pin_at := coalesce (
      nullif (p_payload ->> 'pinned_updated_at', '')::timestamptz,
      'epoch'::timestamptz
    );
    v_pin_keys := coalesce (p_payload -> 'pinned_keys', '[]'::jsonb);

    update public.shop_catalog_meta
    set
      pinned_revisions = v_merged_revs,
      pinned_keys = case
        when v_pin_at >= pinned_updated_at then v_pin_keys
        else pinned_keys
      end,
      pinned_updated_at = greatest (pinned_updated_at, v_pin_at),
      updated_at = now (),
      updated_by = v_uid
    where shop_id = p_shop_id;
  end if;

  return jsonb_build_object (
    'ok', true,
    'rejected_node_ids', to_jsonb (v_rejected)
  );
end;
$$;

revoke all on function public.shop_push_catalog (uuid, jsonb) from public;
grant execute on function public.shop_push_catalog (uuid, jsonb) to authenticated;

-- ---------- Pull catalog (cashiers may read; writers remain manage-shop) ----------
create or replace function public.shop_pull_catalog (
  p_shop_id uuid,
  p_since timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := coalesce (p_since, 'epoch'::timestamptz);
  v_gc timestamptz := now () - interval '90 days';
  v_nodes jsonb;
  v_layout jsonb;
  v_meta jsonb;
  v_max timestamptz;
begin
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'id', n.id,
        'parent_id', n.parent_id,
        'name', n.name,
        'legacy_shelf_key', n.legacy_shelf_key,
        'sort_order', n.sort_order,
        'created_at', n.created_at,
        'updated_at', n.updated_at,
        'deleted_at', n.deleted_at
      )
      order by n.id
    ),
    '[]'::jsonb
  )
  into v_nodes
  from public.shop_catalog_nodes n
  where n.shop_id = p_shop_id
    and (
      n.updated_at > v_since
      or (n.deleted_at is not null and n.deleted_at > v_since)
    )
    and (n.deleted_at is null or n.deleted_at >= v_gc);

  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'shelf_key', l.shelf_key,
        'config', l.config,
        'updated_at', l.updated_at,
        'deleted_at', l.deleted_at
      )
      order by l.shelf_key
    ),
    '[]'::jsonb
  )
  into v_layout
  from public.shop_catalog_shelf_layout l
  where l.shop_id = p_shop_id
    and (
      l.updated_at > v_since
      or (l.deleted_at is not null and l.deleted_at > v_since)
    )
    and (l.deleted_at is null or l.deleted_at >= v_gc);

  select jsonb_build_object (
    'catalog_hierarchy_enabled', m.catalog_hierarchy_enabled,
    'hierarchy_updated_at', m.hierarchy_updated_at,
    'pinned_revisions', m.pinned_revisions,
    'pinned_keys', m.pinned_keys,
    'pinned_updated_at', m.pinned_updated_at
  )
  into v_meta
  from public.shop_catalog_meta m
  where m.shop_id = p_shop_id;

  select greatest (
    v_since,
    (select max (updated_at) from public.shop_catalog_nodes where shop_id = p_shop_id),
    (select max (deleted_at) from public.shop_catalog_nodes where shop_id = p_shop_id),
    (select max (updated_at) from public.shop_catalog_shelf_layout where shop_id = p_shop_id),
    (select max (deleted_at) from public.shop_catalog_shelf_layout where shop_id = p_shop_id),
    (select updated_at from public.shop_catalog_meta where shop_id = p_shop_id)
  )
  into v_max;

  return jsonb_build_object (
    'ok', true,
    'nodes', coalesce (v_nodes, '[]'::jsonb),
    'layout', coalesce (v_layout, '[]'::jsonb),
    'meta', coalesce (v_meta, jsonb_build_object (
      'catalog_hierarchy_enabled', false,
      'hierarchy_updated_at', '1970-01-01T00:00:00Z',
      'pinned_revisions', '{}'::jsonb,
      'pinned_keys', '[]'::jsonb,
      'pinned_updated_at', '1970-01-01T00:00:00Z'
    )),
    'checkpoint_at', coalesce (v_max, now ())
  );
end;
$$;

revoke all on function public.shop_pull_catalog (uuid, timestamptz) from public;
grant execute on function public.shop_pull_catalog (uuid, timestamptz) to authenticated;

comment on table public.shop_catalog_nodes is
  'Shop catalog folder overlay (CatalogNode). Live multi-device sync; not snapshot LWW.';
comment on function public.shop_push_catalog (uuid, jsonb) is
  'Merge catalog nodes/layout/pins by id and timestamp. Rejects resurrecting deleted node ids.';
comment on function public.shop_pull_catalog (uuid, timestamptz) is
  'Incremental catalog pull for any shop member (cashier and above).';
