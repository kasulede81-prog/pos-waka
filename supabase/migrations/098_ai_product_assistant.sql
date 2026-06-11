-- Waka POS — AI Product Assistant (Phase 1 foundation)
-- Platform settings, global product intelligence cache, usage metering.
-- DeepSeek calls run only in Edge Functions (API key never in client).

-- ---------------------------------------------------------------------------
-- Platform AI settings (extends platform_settings)
-- ---------------------------------------------------------------------------

insert into public.platform_settings (key, value)
values (
  'ai_settings',
  jsonb_build_object (
    'ai_enabled', false,
    'ai_business_setup_enabled', false,
    'ai_product_assistant_enabled', false,
    'monthly_ai_generation_limit', 5000,
    'deepseek_model', 'deepseek-chat'
  )
)
on conflict (key) do nothing;

create or replace function public.platform_default_ai_settings ()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object (
    'ai_enabled', false,
    'ai_business_setup_enabled', false,
    'ai_product_assistant_enabled', false,
    'monthly_ai_generation_limit', 5000,
    'deepseek_model', 'deepseek-chat'
  );
$$;

create or replace function public.get_platform_ai_settings ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw jsonb;
begin
  select ps.value into v_raw
  from public.platform_settings ps
  where ps.key = 'ai_settings';

  if v_raw is null or jsonb_typeof (v_raw) <> 'object' then
    return public.platform_default_ai_settings ();
  end if;

  return public.platform_default_ai_settings () || v_raw;
end;
$$;

revoke all on function public.get_platform_ai_settings () from public;
grant execute on function public.get_platform_ai_settings () to authenticated;
grant execute on function public.get_platform_ai_settings () to anon;

create or replace function public.admin_update_platform_ai_settings (p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merged jsonb;
  v_limit integer;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    raise exception 'Forbidden';
  end if;

  v_merged := public.platform_default_ai_settings () || coalesce (p_settings, '{}'::jsonb);

  v_limit := (v_merged ->> 'monthly_ai_generation_limit')::integer;
  if v_limit is null or v_limit < 0 then
    v_limit := 5000;
  end if;
  v_merged := v_merged || jsonb_build_object ('monthly_ai_generation_limit', v_limit);

  if coalesce (v_merged ->> 'deepseek_model', '') not in ('deepseek-chat', 'deepseek-reasoner') then
    v_merged := v_merged || jsonb_build_object ('deepseek_model', 'deepseek-chat');
  end if;

  insert into public.platform_settings (key, value, updated_at, updated_by)
  values ('ai_settings', v_merged, now(), auth.uid ())
  on conflict (key) do update
  set
    value = excluded.value,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  insert into public.internal_ops_admin_audit (actor, action, payload)
  values (
    auth.uid (),
    'platform_ai_settings_updated',
    v_merged
  );

  return jsonb_build_object ('ok', true, 'settings', v_merged);
end;
$$;

revoke all on function public.admin_update_platform_ai_settings (jsonb) from public;
grant execute on function public.admin_update_platform_ai_settings (jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Global product intelligence cache
-- ---------------------------------------------------------------------------

create table if not exists public.product_ai_cache (
  id uuid primary key default gen_random_uuid (),
  product_name_normalized text not null,
  product_name_display text not null,
  business_type text not null default '',
  detected_nature text,
  category text,
  unit text,
  selling_mode text check (selling_mode is null or selling_mode in ('unit', 'weighted', 'portion')),
  pack_type text,
  pieces_per_pack integer check (pieces_per_pack is null or pieces_per_pack > 0),
  confidence_score numeric(4, 3) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  source text not null default 'deepseek' check (source in ('deepseek', 'manual', 'seed')),
  hit_count integer not null default 0 check (hit_count >= 0),
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create unique index if not exists product_ai_cache_lookup_idx
  on public.product_ai_cache (product_name_normalized, business_type);

create index if not exists product_ai_cache_hits_idx
  on public.product_ai_cache (hit_count desc, updated_at desc);

alter table public.product_ai_cache enable row level security;

-- Reads via Edge Function (service role). No direct client writes.
drop policy if exists product_ai_cache_staff_read on public.product_ai_cache;
create policy product_ai_cache_staff_read on public.product_ai_cache
  for select
  using (public.is_waka_internal_staff ());

-- ---------------------------------------------------------------------------
-- AI generation usage (monthly platform limit)
-- ---------------------------------------------------------------------------

create table if not exists public.ai_generation_usage_log (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid references public.shops (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('product_suggest', 'business_setup', 'bulk_inventory')),
  tokens_in integer,
  tokens_out integer,
  cache_hit boolean not null default false,
  created_at timestamptz not null default now ()
);

create index if not exists ai_generation_usage_log_month_idx
  on public.ai_generation_usage_log (created_at desc);

alter table public.ai_generation_usage_log enable row level security;

drop policy if exists ai_generation_usage_staff_read on public.ai_generation_usage_log;
create policy ai_generation_usage_staff_read on public.ai_generation_usage_log
  for select
  using (public.is_waka_internal_staff ());

-- ---------------------------------------------------------------------------
-- Shop AI setup templates (Phase 3 — schema only)
-- ---------------------------------------------------------------------------

alter table public.shops
  add column if not exists ai_setup_completed_at timestamptz;

create table if not exists public.shop_ai_setup_templates (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  detected_nature text not null,
  business_description text,
  shelves jsonb not null default '[]'::jsonb,
  starter_products jsonb not null default '[]'::jsonb,
  model text,
  generated_at timestamptz not null default now (),
  regenerated_by uuid references auth.users (id) on delete set null,
  unique (shop_id)
);

alter table public.shop_ai_setup_templates enable row level security;

drop policy if exists shop_ai_setup_templates_member_read on public.shop_ai_setup_templates;
create policy shop_ai_setup_templates_member_read on public.shop_ai_setup_templates
  for select
  using (
    exists (
      select 1 from public.shop_members sm
      where sm.shop_id = shop_ai_setup_templates.shop_id
        and sm.user_id = auth.uid ()
    )
  );

drop policy if exists shop_ai_setup_templates_staff_all on public.shop_ai_setup_templates;
create policy shop_ai_setup_templates_staff_all on public.shop_ai_setup_templates
  for all
  using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

-- ---------------------------------------------------------------------------
-- Helpers (service role + admin RPCs)
-- ---------------------------------------------------------------------------

create or replace function public.ai_generation_count_this_month ()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count (*)::integer
  from public.ai_generation_usage_log l
  where l.created_at >= date_trunc ('month', now ())
    and l.cache_hit = false;
$$;

revoke all on function public.ai_generation_count_this_month () from public;

create or replace function public.admin_ai_platform_usage_stats ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_used integer;
  v_cache_hits integer;
  v_total integer;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select coalesce ((public.get_platform_ai_settings () ->> 'monthly_ai_generation_limit')::integer, 5000)
  into v_limit;

  select count (*)::integer into v_used
  from public.ai_generation_usage_log l
  where l.created_at >= date_trunc ('month', now ())
    and l.cache_hit = false;

  select count (*)::integer into v_cache_hits
  from public.ai_generation_usage_log l
  where l.created_at >= date_trunc ('month', now ())
    and l.cache_hit = true;

  v_total := v_used + v_cache_hits;

  return jsonb_build_object (
    'monthly_limit', v_limit,
    'generations_this_month', v_used,
    'cache_hits_this_month', v_cache_hits,
    'total_requests_this_month', v_total,
    'cache_hit_rate_pct', case when v_total = 0 then 0 else round ((v_cache_hits::numeric / v_total::numeric) * 100, 1) end,
    'remaining', greatest (0, v_limit - v_used)
  );
end;
$$;

revoke all on function public.admin_ai_platform_usage_stats () from public;
grant execute on function public.admin_ai_platform_usage_stats () to authenticated;

create or replace function public.lookup_product_ai_cache (
  p_product_name_normalized text,
  p_business_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.product_ai_cache%rowtype;
  v_bt text := coalesce (nullif (trim (coalesce (p_business_type, '')), ''), '');
begin
  select * into v_row
  from public.product_ai_cache c
  where c.product_name_normalized = p_product_name_normalized
    and c.business_type = v_bt
  limit 1;

  if v_row.id is null and v_bt <> '' then
    select * into v_row
    from public.product_ai_cache c
    where c.product_name_normalized = p_product_name_normalized
      and c.business_type = ''
    limit 1;
  end if;

  if v_row.id is null then
    return jsonb_build_object ('found', false);
  end if;

  update public.product_ai_cache
  set hit_count = hit_count + 1, updated_at = now ()
  where id = v_row.id;

  return jsonb_build_object (
    'found', true,
    'id', v_row.id,
    'product_name_display', v_row.product_name_display,
    'category', v_row.category,
    'unit', v_row.unit,
    'selling_mode', v_row.selling_mode,
    'pack_type', v_row.pack_type,
    'pieces_per_pack', v_row.pieces_per_pack,
    'confidence_score', v_row.confidence_score,
    'detected_nature', v_row.detected_nature
  );
end;
$$;

revoke all on function public.lookup_product_ai_cache (text, text) from public;

create or replace function public.upsert_product_ai_cache (
  p_product_name_normalized text,
  p_product_name_display text,
  p_business_type text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_bt text := coalesce (nullif (trim (coalesce (p_business_type, '')), ''), '');
begin
  insert into public.product_ai_cache (
    product_name_normalized,
    product_name_display,
    business_type,
    detected_nature,
    category,
    unit,
    selling_mode,
    pack_type,
    pieces_per_pack,
    confidence_score,
    source,
    hit_count
  )
  values (
    p_product_name_normalized,
    p_product_name_display,
    v_bt,
    nullif (p_payload ->> 'detected_nature', ''),
    nullif (p_payload ->> 'category', ''),
    nullif (p_payload ->> 'unit', ''),
    nullif (p_payload ->> 'selling_mode', ''),
    nullif (p_payload ->> 'pack_type', ''),
    nullif ((p_payload ->> 'pieces_per_pack')::integer, 0),
    (p_payload ->> 'confidence_score')::numeric,
    coalesce (nullif (p_payload ->> 'source', ''), 'deepseek'),
    0
  )
  on conflict (product_name_normalized, business_type)
  do update set
    product_name_display = excluded.product_name_display,
    detected_nature = excluded.detected_nature,
    category = excluded.category,
    unit = excluded.unit,
    selling_mode = excluded.selling_mode,
    pack_type = excluded.pack_type,
    pieces_per_pack = excluded.pieces_per_pack,
    confidence_score = excluded.confidence_score,
    updated_at = now ()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_product_ai_cache (text, text, text, jsonb) from public;

create or replace function public.log_ai_generation (
  p_shop_id uuid,
  p_user_id uuid,
  p_kind text,
  p_tokens_in integer,
  p_tokens_out integer,
  p_cache_hit boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ai_generation_usage_log (
    shop_id, user_id, kind, tokens_in, tokens_out, cache_hit
  )
  values (
    p_shop_id,
    p_user_id,
    p_kind,
    p_tokens_in,
    p_tokens_out,
    coalesce (p_cache_hit, false)
  );
end;
$$;

revoke all on function public.log_ai_generation (uuid, uuid, text, integer, integer, boolean) from public;
