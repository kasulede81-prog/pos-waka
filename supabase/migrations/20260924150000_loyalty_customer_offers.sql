-- WAKA Loyalty — Decision 026: additive customer offers (Model B).
-- Does NOT modify C1/C2/C3 migration files. CREATE OR REPLACE award/redeem only.
-- Merchant loyalty_programs remains the authoritative baseline.

-- ---------- Schema ----------
alter table public.loyalty_rewards
  add column if not exists requires_offer_grant boolean not null default false;

comment on column public.loyalty_rewards.requires_offer_grant is
  'When true, only accounts with an applicable reward_grant offer may redeem. Default false preserves shop-wide rewards.';

create unique index if not exists loyalty_accounts_id_shop_uidx
  on public.loyalty_accounts (id, shop_id);

create table if not exists public.loyalty_customer_offers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  account_id uuid not null,
  offer_kind text not null
    check (offer_kind in (
      'earn_multiplier', 'earn_bonus_flat', 'reward_grant', 'status_badge', 'campaign'
    )),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  priority integer not null default 0,
  config jsonb not null default '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'paused', 'revoked')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  note text,
  constraint loyalty_customer_offers_window_chk
    check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint loyalty_customer_offers_account_shop_fk
    foreign key (account_id, shop_id)
    references public.loyalty_accounts (id, shop_id)
    on delete cascade
);

create index if not exists loyalty_customer_offers_account_status_idx
  on public.loyalty_customer_offers (account_id, status, starts_at, ends_at);

create index if not exists loyalty_customer_offers_shop_idx
  on public.loyalty_customer_offers (shop_id, status);

alter table public.loyalty_customer_offers enable row level security;

drop policy if exists loyalty_customer_offers_select on public.loyalty_customer_offers;
create policy loyalty_customer_offers_select
  on public.loyalty_customer_offers for select
  using (public.user_can_access_shop (shop_id));

revoke all on public.loyalty_customer_offers from anon;
grant select on public.loyalty_customer_offers to authenticated;

comment on table public.loyalty_customer_offers is
  'Decision 026: additive per-account offers on top of shop loyalty_programs. Never replaces the program.';

-- ---------- Window helper ----------
create or replace function public.loyalty_offer_window_active (
  p_status text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_now timestamptz default now()
)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select
    p_status = 'active'
    and (p_starts_at is null or p_now >= p_starts_at)
    and (p_ends_at is null or p_now < p_ends_at);
$fn$;

revoke all on function public.loyalty_offer_window_active (text, timestamptz, timestamptz, timestamptz) from public;
grant execute on function public.loyalty_offer_window_active (text, timestamptz, timestamptz, timestamptz) to authenticated;

-- ---------- Config validation ----------
create or replace function public.loyalty_validate_offer_config (
  p_shop_id uuid,
  p_offer_kind text,
  p_config jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_kind text := lower(btrim(coalesce(p_offer_kind, '')));
  v_cfg jsonb := coalesce(p_config, '{}'::jsonb);
  v_mult numeric;
  v_pts integer;
  v_label text;
  v_ids jsonb;
  v_id text;
  v_effect jsonb;
  v_effects jsonb;
  v_ekind text;
  v_child jsonb;
  v_i integer;
  v_extra integer;
begin
  if jsonb_typeof(v_cfg) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid_config');
  end if;
  if v_cfg ? 'html' or v_cfg ? 'script' or v_cfg ? 'url' or v_cfg ? 'javascript' then
    return jsonb_build_object('ok', false, 'error', 'unsafe_config');
  end if;

  if v_kind = 'earn_multiplier' then
    select count(*)::int into v_extra
    from jsonb_object_keys(v_cfg) as k(key)
    where k.key not in ('multiplier');
    if v_extra > 0 or jsonb_typeof(v_cfg -> 'multiplier') is distinct from 'number' then
      return jsonb_build_object('ok', false, 'error', 'invalid_multiplier');
    end if;
    v_mult := (v_cfg ->> 'multiplier')::numeric;
    if v_mult is null or v_mult <> v_mult or v_mult <= 0 or v_mult > 10 then
      return jsonb_build_object('ok', false, 'error', 'invalid_multiplier');
    end if;
    return jsonb_build_object('ok', true);

  elsif v_kind = 'earn_bonus_flat' then
    select count(*)::int into v_extra
    from jsonb_object_keys(v_cfg) as k(key)
    where k.key not in ('points');
    if v_extra > 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_config_keys');
    end if;
    begin
      v_pts := (v_cfg ->> 'points')::integer;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'invalid_bonus_points');
    end;
    if v_pts is null or v_pts < 0 or v_pts > 1000000 then
      return jsonb_build_object('ok', false, 'error', 'invalid_bonus_points');
    end if;
    return jsonb_build_object('ok', true);

  elsif v_kind = 'reward_grant' then
    select count(*)::int into v_extra
    from jsonb_object_keys(v_cfg) as k(key)
    where k.key not in ('reward_ids');
    if v_extra > 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_config_keys');
    end if;
    v_ids := v_cfg -> 'reward_ids';
    if jsonb_typeof(v_ids) is distinct from 'array'
       or jsonb_array_length(v_ids) < 1
       or jsonb_array_length(v_ids) > 50 then
      return jsonb_build_object('ok', false, 'error', 'invalid_reward_ids');
    end if;
    for v_i in 0 .. jsonb_array_length(v_ids) - 1 loop
      v_id := v_ids ->> v_i;
      if v_id is null or v_id !~ '^[0-9a-fA-F-]{36}$' then
        return jsonb_build_object('ok', false, 'error', 'invalid_reward_ids');
      end if;
      if not exists (
        select 1 from public.loyalty_rewards r
        where r.id = v_id::uuid and r.shop_id = p_shop_id
      ) then
        return jsonb_build_object('ok', false, 'error', 'reward_not_in_shop');
      end if;
    end loop;
    return jsonb_build_object('ok', true);

  elsif v_kind = 'status_badge' then
    select count(*)::int into v_extra
    from jsonb_object_keys(v_cfg) as k(key)
    where k.key not in ('label');
    if v_extra > 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_config_keys');
    end if;
    v_label := btrim(coalesce(v_cfg ->> 'label', ''));
    if char_length(v_label) < 1 or char_length(v_label) > 40 then
      return jsonb_build_object('ok', false, 'error', 'invalid_badge_label');
    end if;
    if v_label ~* '(<script|javascript:|https?://)' then
      return jsonb_build_object('ok', false, 'error', 'unsafe_badge_label');
    end if;
    return jsonb_build_object('ok', true);

  elsif v_kind = 'campaign' then
    select count(*)::int into v_extra
    from jsonb_object_keys(v_cfg) as k(key)
    where k.key not in ('effects');
    if v_extra > 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_config_keys');
    end if;
    v_effects := v_cfg -> 'effects';
    if jsonb_typeof(v_effects) is distinct from 'array'
       or jsonb_array_length(v_effects) < 1
       or jsonb_array_length(v_effects) > 20 then
      return jsonb_build_object('ok', false, 'error', 'invalid_campaign_effects');
    end if;
    for v_i in 0 .. jsonb_array_length(v_effects) - 1 loop
      v_effect := v_effects -> v_i;
      if jsonb_typeof(v_effect) is distinct from 'object' then
        return jsonb_build_object('ok', false, 'error', 'invalid_campaign_effects');
      end if;
      v_ekind := lower(btrim(coalesce(v_effect ->> 'kind', '')));
      if v_ekind not in ('earn_multiplier', 'earn_bonus_flat', 'reward_grant', 'status_badge') then
        return jsonb_build_object('ok', false, 'error', 'invalid_campaign_child_kind');
      end if;
      v_child := public.loyalty_validate_offer_config(p_shop_id, v_ekind, v_effect - 'kind');
      if coalesce((v_child ->> 'ok')::boolean, false) is not true then
        return v_child;
      end if;
    end loop;
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('ok', false, 'error', 'invalid_offer_kind');
end;
$fn$;

revoke all on function public.loyalty_validate_offer_config (uuid, text, jsonb) from public;
revoke all on function public.loyalty_validate_offer_config (uuid, text, jsonb) from anon;
grant execute on function public.loyalty_validate_offer_config (uuid, text, jsonb) to authenticated;

-- ---------- Authoritative resolver ----------
create or replace function public.loyalty_resolve_customer_offers (
  p_account_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_account public.loyalty_accounts%rowtype;
  v_now timestamptz := coalesce(p_now, now());
  v_offer record;
  v_eff record;
  v_best_mult numeric := 1;
  v_best_offer uuid := null;
  v_best_pri integer := null;
  v_flat integer := 0;
  v_flat_parts jsonb := '[]'::jsonb;
  v_grants jsonb := '[]'::jsonb;
  v_badges jsonb := '[]'::jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_j integer;
  v_rid text;
  v_mult numeric;
  v_pts integer;
  v_take boolean;
begin
  select * into v_account from public.loyalty_accounts where id = p_account_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;

  for v_offer in
    select o.*
    from public.loyalty_customer_offers o
    where o.account_id = p_account_id
      and o.shop_id = v_account.shop_id
      and public.loyalty_offer_window_active(o.status, o.starts_at, o.ends_at, v_now)
    order by o.priority desc, o.id asc
  loop
    v_applied := v_applied || jsonb_build_array(jsonb_build_object(
      'id', v_offer.id,
      'kind', v_offer.offer_kind,
      'title', v_offer.title,
      'priority', v_offer.priority
    ));
  end loop;

  -- Flatten offers + campaign children into effect rows, then stack.
  for v_eff in
    with active as (
      select o.*
      from public.loyalty_customer_offers o
      where o.account_id = p_account_id
        and o.shop_id = v_account.shop_id
        and public.loyalty_offer_window_active(o.status, o.starts_at, o.ends_at, v_now)
    ),
    effects as (
      select
        a.id as offer_id,
        a.offer_kind,
        a.title,
        a.priority,
        a.offer_kind as effect_kind,
        a.config as effect_config
      from active a
      where a.offer_kind <> 'campaign'
      union all
      select
        a.id,
        a.offer_kind,
        a.title,
        a.priority,
        lower(btrim(e.elem ->> 'kind')),
        e.elem - 'kind'
      from active a
      cross join lateral jsonb_array_elements(coalesce(a.config -> 'effects', '[]'::jsonb)) as e(elem)
      where a.offer_kind = 'campaign'
    )
    select * from effects
    order by priority desc, offer_id asc
  loop
    if v_eff.effect_kind = 'earn_multiplier' then
      v_mult := (v_eff.effect_config ->> 'multiplier')::numeric;
      if v_mult is null or v_mult <= 0 then
        continue;
      end if;
      v_take := false;
      if v_mult > v_best_mult then
        v_take := true;
      elsif v_mult = v_best_mult then
        if v_best_pri is null
           or v_eff.priority > v_best_pri
           or (v_eff.priority = v_best_pri and (v_best_offer is null or v_eff.offer_id < v_best_offer)) then
          v_take := true;
        end if;
      end if;
      if v_take then
        v_best_mult := v_mult;
        v_best_offer := v_eff.offer_id;
        v_best_pri := v_eff.priority;
      end if;

    elsif v_eff.effect_kind = 'earn_bonus_flat' then
      v_pts := coalesce((v_eff.effect_config ->> 'points')::integer, 0);
      if v_pts > 0 then
        v_flat := v_flat + v_pts;
        v_flat_parts := v_flat_parts || jsonb_build_array(jsonb_build_object(
          'offer_id', v_eff.offer_id,
          'title', v_eff.title,
          'points', v_pts
        ));
      end if;

    elsif v_eff.effect_kind = 'reward_grant' then
      for v_j in 0 .. coalesce(jsonb_array_length(v_eff.effect_config -> 'reward_ids'), 0) - 1 loop
        v_rid := (v_eff.effect_config -> 'reward_ids') ->> v_j;
        if v_rid is not null
           and not exists (
             select 1 from jsonb_array_elements_text(v_grants) g(x) where g.x = v_rid
           ) then
          v_grants := v_grants || jsonb_build_array(v_rid);
        end if;
      end loop;

    elsif v_eff.effect_kind = 'status_badge' then
      v_badges := v_badges || jsonb_build_array(jsonb_build_object(
        'offer_id', v_eff.offer_id,
        'label', btrim(coalesce(v_eff.effect_config ->> 'label', ''))
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'shop_id', v_account.shop_id,
    'resolved_at', v_now,
    'applicable_offers', v_applied,
    'effective_multiplier', v_best_mult,
    'multiplier_offer_id', v_best_offer,
    'flat_bonus_points', v_flat,
    'flat_bonus_parts', v_flat_parts,
    'reward_grant_ids', v_grants,
    'status_badges', v_badges
  );
end;
$fn$;

revoke all on function public.loyalty_resolve_customer_offers (uuid, timestamptz) from public;
revoke all on function public.loyalty_resolve_customer_offers (uuid, timestamptz) from anon;
grant execute on function public.loyalty_resolve_customer_offers (uuid, timestamptz) to authenticated;

-- Compose final points: (base * multiplier) + flat_bonuses
create or replace function public.loyalty_compose_offer_points (
  p_base_points integer,
  p_resolution jsonb
)
returns integer
language sql
immutable
set search_path = public
as $fn$
  select greatest (
    0,
    (coalesce(p_base_points, 0)
      * coalesce((p_resolution ->> 'effective_multiplier')::numeric, 1)
    )::integer
    + coalesce((p_resolution ->> 'flat_bonus_points')::integer, 0)
  );
$fn$;

revoke all on function public.loyalty_compose_offer_points (integer, jsonb) from public;
grant execute on function public.loyalty_compose_offer_points (integer, jsonb) to authenticated;

-- ---------- CRUD RPCs ----------
create or replace function public.loyalty_list_customer_offers (
  p_shop_id uuid,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not exists (
    select 1 from public.loyalty_accounts a
    where a.id = p_account_id and a.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'shop_id', o.shop_id,
        'account_id', o.account_id,
        'offer_kind', o.offer_kind,
        'title', o.title,
        'priority', o.priority,
        'config', o.config,
        'starts_at', o.starts_at,
        'ends_at', o.ends_at,
        'status', o.status,
        'created_at', o.created_at,
        'revoked_at', o.revoked_at,
        'note', o.note,
        'window_active', public.loyalty_offer_window_active(o.status, o.starts_at, o.ends_at, now())
      ) order by o.status asc, o.priority desc, o.created_at desc)
      from public.loyalty_customer_offers o
      where o.shop_id = p_shop_id and o.account_id = p_account_id
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.loyalty_list_customer_offers (uuid, uuid) from public;
grant execute on function public.loyalty_list_customer_offers (uuid, uuid) to authenticated;

create or replace function public.loyalty_create_customer_offer (
  p_shop_id uuid,
  p_account_id uuid,
  p_offer_kind text,
  p_title text,
  p_config jsonb,
  p_priority integer default 0,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_kind text := lower(btrim(coalesce(p_offer_kind, '')));
  v_title text := btrim(coalesce(p_title, ''));
  v_val jsonb;
  v_id uuid;
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not exists (
    select 1 from public.loyalty_accounts a
    where a.id = p_account_id and a.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;
  if v_kind not in ('earn_multiplier', 'earn_bonus_flat', 'reward_grant', 'status_badge', 'campaign') then
    return jsonb_build_object('ok', false, 'error', 'invalid_offer_kind');
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 80 then
    return jsonb_build_object('ok', false, 'error', 'invalid_title');
  end if;
  if p_ends_at is not null and p_starts_at is not null and p_ends_at <= p_starts_at then
    return jsonb_build_object('ok', false, 'error', 'invalid_window');
  end if;

  v_val := public.loyalty_validate_offer_config(p_shop_id, v_kind, p_config);
  if coalesce((v_val ->> 'ok')::boolean, false) is not true then
    return v_val;
  end if;

  insert into public.loyalty_customer_offers (
    shop_id, account_id, offer_kind, title, priority, config,
    starts_at, ends_at, status, created_by, note
  )
  values (
    p_shop_id, p_account_id, v_kind, v_title, coalesce(p_priority, 0), coalesce(p_config, '{}'::jsonb),
    p_starts_at, p_ends_at, 'active', auth.uid (), nullif(btrim(coalesce(p_note, '')), '')
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'offer_id', v_id);
end;
$fn$;

revoke all on function public.loyalty_create_customer_offer (uuid, uuid, text, text, jsonb, integer, timestamptz, timestamptz, text) from public;
grant execute on function public.loyalty_create_customer_offer (uuid, uuid, text, text, jsonb, integer, timestamptz, timestamptz, text) to authenticated;

create or replace function public.loyalty_update_customer_offer (
  p_shop_id uuid,
  p_offer_id uuid,
  p_title text default null,
  p_config jsonb default null,
  p_priority integer default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_clear_starts boolean default false,
  p_clear_ends boolean default false,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_offer public.loyalty_customer_offers%rowtype;
  v_val jsonb;
  v_title text;
  v_config jsonb;
  v_starts timestamptz;
  v_ends timestamptz;
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_offer
  from public.loyalty_customer_offers
  where id = p_offer_id and shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'offer_not_found');
  end if;
  if v_offer.status = 'revoked' then
    return jsonb_build_object('ok', false, 'error', 'offer_revoked');
  end if;

  v_title := coalesce(nullif(btrim(coalesce(p_title, '')), ''), v_offer.title);
  if char_length(v_title) < 1 or char_length(v_title) > 80 then
    return jsonb_build_object('ok', false, 'error', 'invalid_title');
  end if;

  v_config := coalesce(p_config, v_offer.config);
  v_val := public.loyalty_validate_offer_config(p_shop_id, v_offer.offer_kind, v_config);
  if coalesce((v_val ->> 'ok')::boolean, false) is not true then
    return v_val;
  end if;

  if p_clear_starts then
    v_starts := null;
  elsif p_starts_at is not null then
    v_starts := p_starts_at;
  else
    v_starts := v_offer.starts_at;
  end if;

  if p_clear_ends then
    v_ends := null;
  elsif p_ends_at is not null then
    v_ends := p_ends_at;
  else
    v_ends := v_offer.ends_at;
  end if;

  if v_ends is not null and v_starts is not null and v_ends <= v_starts then
    return jsonb_build_object('ok', false, 'error', 'invalid_window');
  end if;

  update public.loyalty_customer_offers
  set title = v_title,
      config = v_config,
      priority = coalesce(p_priority, priority),
      starts_at = v_starts,
      ends_at = v_ends,
      note = case
        when p_note is null then note
        else nullif(btrim(p_note), '')
      end
  where id = p_offer_id;

  return jsonb_build_object('ok', true, 'offer_id', p_offer_id);
end;
$fn$;

revoke all on function public.loyalty_update_customer_offer (uuid, uuid, text, jsonb, integer, timestamptz, timestamptz, boolean, boolean, text) from public;
grant execute on function public.loyalty_update_customer_offer (uuid, uuid, text, jsonb, integer, timestamptz, timestamptz, boolean, boolean, text) to authenticated;

create or replace function public.loyalty_set_customer_offer_status (
  p_shop_id uuid,
  p_offer_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_offer public.loyalty_customer_offers%rowtype;
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_status not in ('active', 'paused', 'revoked') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  select * into v_offer
  from public.loyalty_customer_offers
  where id = p_offer_id and shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'offer_not_found');
  end if;
  if v_offer.status = 'revoked' and v_status is distinct from 'revoked' then
    return jsonb_build_object('ok', false, 'error', 'offer_revoked');
  end if;

  update public.loyalty_customer_offers
  set status = v_status,
      revoked_at = case when v_status = 'revoked' then coalesce(revoked_at, now()) else revoked_at end
  where id = p_offer_id;

  return jsonb_build_object('ok', true, 'offer_id', p_offer_id, 'status', v_status);
end;
$fn$;

revoke all on function public.loyalty_set_customer_offer_status (uuid, uuid, text) from public;
grant execute on function public.loyalty_set_customer_offer_status (uuid, uuid, text) to authenticated;

-- Preview resolve for merchant/POS (sanitized)
create or replace function public.loyalty_preview_account_offers (
  p_shop_id uuid,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_res jsonb;
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not exists (
    select 1 from public.loyalty_accounts a
    where a.id = p_account_id and a.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;
  v_res := public.loyalty_resolve_customer_offers(p_account_id, now());
  return v_res;
end;
$fn$;

revoke all on function public.loyalty_preview_account_offers (uuid, uuid) from public;
grant execute on function public.loyalty_preview_account_offers (uuid, uuid) to authenticated;

-- ---------- Award: program + offers + C1 + C3 (does not edit C3 migration file) ----------
create or replace function public.loyalty_award_for_sale (p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale public.sales%rowtype;
  v_program public.loyalty_programs%rowtype;
  v_account public.loyalty_accounts%rowtype;
  v_account_id uuid;
  v_tx_id uuid;
  v_base integer;
  v_points integer;
  v_eligible bigint;
  v_new boolean := false;
  v_expires timestamptz;
  v_offers jsonb;
  v_snapshot jsonb;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sale_not_found');
  end if;
  if v_sale.status is distinct from 'completed' then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'sale_not_completed');
  end if;
  if v_sale.customer_id is null then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'no_customer');
  end if;

  select * into v_program from public.loyalty_programs where shop_id = v_sale.shop_id;
  if not found or not v_program.enabled then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'program_disabled');
  end if;

  insert into public.loyalty_accounts (shop_id, customer_id, enrolled_by)
  values (v_sale.shop_id, v_sale.customer_id, auth.uid ())
  on conflict (shop_id, customer_id) do nothing
  returning id into v_account_id;
  if v_account_id is not null then
    v_new := true;
    perform public.loyalty_stamp_new_account_membership(v_account_id, v_sale.shop_id);
  else
    select id into v_account_id
    from public.loyalty_accounts
    where shop_id = v_sale.shop_id and customer_id = v_sale.customer_id;
  end if;

  select * into v_account from public.loyalty_accounts where id = v_account_id;

  -- C1 membership gate BEFORE offer resolution
  if not public.loyalty_account_membership_active(v_account.status, v_account.membership_expires_at, now()) then
    return jsonb_build_object(
      'ok', true,
      'awarded', false,
      'reason', 'membership_expired',
      'account_id', v_account_id
    );
  end if;

  v_eligible := greatest (v_sale.total_ugx - v_program.min_eligible_spend_ugx, 0);
  v_base := ((v_eligible / v_program.earn_unit_ugx) * v_program.earn_points_per_unit)::integer;

  v_offers := public.loyalty_resolve_customer_offers(v_account_id, now());
  if coalesce((v_offers ->> 'ok')::boolean, false) is not true then
    v_offers := jsonb_build_object(
      'ok', true,
      'effective_multiplier', 1,
      'flat_bonus_points', 0,
      'applicable_offers', '[]'::jsonb,
      'flat_bonus_parts', '[]'::jsonb,
      'reward_grant_ids', '[]'::jsonb,
      'status_badges', '[]'::jsonb
    );
  end if;

  v_points := public.loyalty_compose_offer_points(v_base, v_offers);

  if v_points <= 0 then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'below_threshold', 'account_id', v_account_id);
  end if;

  -- C3 expiry stamp on the composed earn lot
  v_expires := public.loyalty_compute_earn_expires_at(
    v_program.points_expiry_mode,
    v_program.points_expiry_months,
    now()
  );

  v_snapshot := jsonb_build_object(
    'rule_kind', v_program.rule_kind,
    'earn_unit_ugx', v_program.earn_unit_ugx,
    'earn_points_per_unit', v_program.earn_points_per_unit,
    'eligible_spend_ugx', v_eligible,
    'points_expiry_mode', v_program.points_expiry_mode,
    'points_expiry_months', v_program.points_expiry_months,
    'base_points', v_base,
    'effective_multiplier', coalesce((v_offers ->> 'effective_multiplier')::numeric, 1),
    'multiplier_offer_id', v_offers -> 'multiplier_offer_id',
    'flat_bonus_points', coalesce((v_offers ->> 'flat_bonus_points')::integer, 0),
    'flat_bonus_parts', coalesce(v_offers -> 'flat_bonus_parts', '[]'::jsonb),
    'applicable_offers', coalesce(v_offers -> 'applicable_offers', '[]'::jsonb),
    'effective_points', v_points,
    'offers_resolved_at', v_offers -> 'resolved_at'
  );

  begin
    insert into public.loyalty_transactions (
      shop_id, account_id, kind, points, cause, source_sale_id,
      rule_snapshot, actor, actor_source, expires_at
    )
    values (
      v_sale.shop_id, v_account_id, 'earned', v_points, 'sale', v_sale.id,
      v_snapshot,
      auth.uid (), 'system', v_expires
    )
    returning id into v_tx_id;
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'already_awarded', 'account_id', v_account_id);
  end;

  perform public.loyalty_apply_pending_reversals(v_sale.id);

  return jsonb_build_object(
    'ok', true,
    'awarded', true,
    'points', v_points,
    'base_points', v_base,
    'transaction_id', v_tx_id,
    'account_id', v_account_id,
    'new_account', v_new,
    'expires_at', v_expires,
    'effective_multiplier', coalesce((v_offers ->> 'effective_multiplier')::numeric, 1),
    'flat_bonus_points', coalesce((v_offers ->> 'flat_bonus_points')::integer, 0)
  );
end;
$function$;

revoke all on function public.loyalty_award_for_sale (uuid) from public;
revoke all on function public.loyalty_award_for_sale (uuid) from anon;
revoke all on function public.loyalty_award_for_sale (uuid) from authenticated;

-- ---------- Redeem: keep C1/C2/C3 order; add grant gate when required ----------
create or replace function public.loyalty_redeem_reward (
  p_shop_id uuid,
  p_account_id uuid,
  p_reward_id uuid,
  p_idempotency_key text,
  p_note text default null,
  p_sale_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_account public.loyalty_accounts%rowtype;
  v_reward public.loyalty_rewards%rowtype;
  v_existing public.loyalty_redemptions%rowtype;
  v_redemption_id uuid;
  v_tx_id uuid;
  v_prior_count integer;
  v_offers jsonb;
  v_granted boolean;
begin
  if not public.user_can_redeem_loyalty (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if p_idempotency_key is null or btrim (p_idempotency_key) = '' then
    return jsonb_build_object ('ok', false, 'error', 'idempotency_key_required');
  end if;

  select * into v_existing
  from public.loyalty_redemptions
  where shop_id = p_shop_id
    and idempotency_key = btrim (p_idempotency_key)
    and status = 'completed';
  if found then
    return jsonb_build_object (
      'ok', true,
      'redemption_id', v_existing.id,
      'already_redeemed', true,
      'points_spent', v_existing.points_spent,
      'balance', (
        select balance_points from public.loyalty_accounts where id = v_existing.account_id
      )
    );
  end if;

  select * into v_reward
  from public.loyalty_rewards
  where id = p_reward_id and shop_id = p_shop_id;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'reward_not_found');
  end if;

  select * into v_account
  from public.loyalty_accounts
  where id = p_account_id and shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'account_not_found');
  end if;
  if v_account.status <> 'active' then
    return jsonb_build_object ('ok', false, 'error', 'account_disabled');
  end if;
  if not public.loyalty_account_membership_active(v_account.status, v_account.membership_expires_at, now()) then
    return jsonb_build_object ('ok', false, 'error', 'membership_expired');
  end if;

  select * into v_existing
  from public.loyalty_redemptions
  where shop_id = p_shop_id
    and idempotency_key = btrim (p_idempotency_key)
    and status = 'completed';
  if found then
    return jsonb_build_object (
      'ok', true,
      'redemption_id', v_existing.id,
      'already_redeemed', true,
      'points_spent', v_existing.points_spent,
      'balance', v_account.balance_points
    );
  end if;

  select * into v_reward
  from public.loyalty_rewards
  where id = p_reward_id and shop_id = p_shop_id;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'reward_not_found');
  end if;
  if not v_reward.active then
    return jsonb_build_object ('ok', false, 'error', 'reward_inactive');
  end if;
  if not public.loyalty_reward_unexpired(v_reward.expires_on, now()) then
    return jsonb_build_object ('ok', false, 'error', 'reward_expired');
  end if;

  -- Decision 026: grant-only rewards require an applicable reward_grant
  if coalesce(v_reward.requires_offer_grant, false) then
    v_offers := public.loyalty_resolve_customer_offers(v_account.id, now());
    v_granted := exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_offers -> 'reward_grant_ids', '[]'::jsonb)) g(x)
      where g.x = v_reward.id::text
    );
    if not v_granted then
      return jsonb_build_object ('ok', false, 'error', 'reward_grant_required');
    end if;
  end if;

  perform public.loyalty_expire_due_points(v_account.id);
  select * into v_account from public.loyalty_accounts where id = p_account_id;

  if v_reward.max_redemptions_per_account is not null then
    select count(*) into v_prior_count
    from public.loyalty_redemptions
    where account_id = v_account.id
      and reward_id = v_reward.id
      and status = 'completed';
    if v_prior_count >= v_reward.max_redemptions_per_account then
      return jsonb_build_object ('ok', false, 'error', 'redemption_limit_reached');
    end if;
  end if;

  if v_account.balance_points < v_reward.points_required then
    return jsonb_build_object (
      'ok', false,
      'error', 'insufficient_points',
      'balance', v_account.balance_points,
      'required', v_reward.points_required
    );
  end if;

  insert into public.loyalty_redemptions (
    shop_id, account_id, reward_id, points_spent, idempotency_key, actor, note, sale_id
  )
  values (
    p_shop_id,
    v_account.id,
    v_reward.id,
    v_reward.points_required,
    btrim (p_idempotency_key),
    auth.uid (),
    nullif (btrim (coalesce (p_note, '')), ''),
    p_sale_id
  )
  returning id into v_redemption_id;

  insert into public.loyalty_transactions (
    shop_id, account_id, kind, points, cause, actor, actor_source, note, idempotency_key
  )
  values (
    p_shop_id,
    v_account.id,
    'redeemed',
    -v_reward.points_required,
    'redemption',
    auth.uid (),
    'staff',
    nullif (btrim (coalesce (p_note, '')), ''),
    'redemption:' || v_redemption_id::text
  )
  returning id into v_tx_id;

  perform public.loyalty_allocate_fifo(
    v_account.id, v_tx_id, v_reward.points_required, 'redeemed', false, true
  );

  update public.loyalty_redemptions
  set ledger_transaction_id = v_tx_id
  where id = v_redemption_id;

  return jsonb_build_object (
    'ok', true,
    'redemption_id', v_redemption_id,
    'transaction_id', v_tx_id,
    'already_redeemed', false,
    'points_spent', v_reward.points_required,
    'balance', (select balance_points from public.loyalty_accounts where id = v_account.id)
  );
end;
$function$;

revoke all on function public.loyalty_redeem_reward (uuid, uuid, uuid, text, text, uuid) from public;
revoke all on function public.loyalty_redeem_reward (uuid, uuid, uuid, text, text, uuid) from anon;
grant execute on function public.loyalty_redeem_reward (uuid, uuid, uuid, text, text, uuid) to authenticated;

