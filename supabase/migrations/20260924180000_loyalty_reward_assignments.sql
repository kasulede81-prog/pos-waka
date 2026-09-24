-- Decision 029 — Customer-specific reward assignments (additive).
-- Explicit assignment table; D026 reward_grant remains valid eligibility path.
-- Existing requires_offer_grant=false shop-wide rewards unchanged.
-- Does NOT modify C1–C3 / D026–D028 migration files.

-- ---------- Reward (id, shop_id) for composite FKs ----------
create unique index if not exists loyalty_rewards_id_shop_uidx
  on public.loyalty_rewards (id, shop_id);

-- ---------- Assignments ----------
create table if not exists public.loyalty_reward_assignments (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  account_id uuid not null,
  reward_id uuid not null,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  expires_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now (),
  revoked_at timestamptz,
  note text,
  constraint loyalty_reward_assignments_account_shop_fk
    foreign key (account_id, shop_id)
    references public.loyalty_accounts (id, shop_id)
    on delete cascade,
  constraint loyalty_reward_assignments_reward_shop_fk
    foreign key (reward_id, shop_id)
    references public.loyalty_rewards (id, shop_id)
    on delete cascade
);

comment on table public.loyalty_reward_assignments is
  'Decision 029: per-account reward eligibility assignments. Distinct from D026 time-windowed offers.';

-- At most one active assignment per shop+account+reward.
create unique index if not exists loyalty_reward_assignments_active_uidx
  on public.loyalty_reward_assignments (shop_id, account_id, reward_id)
  where status = 'active';

create index if not exists loyalty_reward_assignments_account_idx
  on public.loyalty_reward_assignments (account_id, status);

create index if not exists loyalty_reward_assignments_shop_idx
  on public.loyalty_reward_assignments (shop_id, status);

alter table public.loyalty_reward_assignments enable row level security;

drop policy if exists loyalty_reward_assignments_select on public.loyalty_reward_assignments;
create policy loyalty_reward_assignments_select
  on public.loyalty_reward_assignments for select
  using (public.user_can_access_shop (shop_id));

revoke all on table public.loyalty_reward_assignments from public;
revoke all on table public.loyalty_reward_assignments from anon;
grant select on table public.loyalty_reward_assignments to authenticated;
do $gr$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.loyalty_reward_assignments to service_role;
  end if;
end;
$gr$;

-- ---------- Helpers ----------
create or replace function public.loyalty_assignment_active (
  p_status text,
  p_expires_at timestamptz,
  p_now timestamptz default now()
)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select
    p_status = 'active'
    and (p_expires_at is null or p_now < p_expires_at);
$fn$;

revoke all on function public.loyalty_assignment_active (text, timestamptz, timestamptz) from public;
grant execute on function public.loyalty_assignment_active (text, timestamptz, timestamptz) to authenticated;

-- True when account may redeem a requires_offer_grant reward via D026 grant OR D029 assignment.
create or replace function public.loyalty_account_reward_granted (
  p_account_id uuid,
  p_reward_id uuid,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_offers jsonb;
  v_granted boolean;
begin
  if exists (
    select 1
    from public.loyalty_reward_assignments a
    where a.account_id = p_account_id
      and a.reward_id = p_reward_id
      and public.loyalty_assignment_active (a.status, a.expires_at, p_now)
  ) then
    return true;
  end if;

  v_offers := public.loyalty_resolve_customer_offers (p_account_id, p_now);
  v_granted := exists (
    select 1
    from jsonb_array_elements_text (coalesce (v_offers -> 'reward_grant_ids', '[]'::jsonb)) g (x)
    where g.x = p_reward_id::text
  );
  return coalesce (v_granted, false);
end;
$fn$;

revoke all on function public.loyalty_account_reward_granted (uuid, uuid, timestamptz) from public;
revoke all on function public.loyalty_account_reward_granted (uuid, uuid, timestamptz) from anon;
grant execute on function public.loyalty_account_reward_granted (uuid, uuid, timestamptz) to authenticated;

-- ---------- Merchant RPCs ----------
create or replace function public.loyalty_list_reward_assignments (
  p_shop_id uuid,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rows jsonb;
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;
  if not exists (
    select 1 from public.loyalty_accounts
    where id = p_account_id and shop_id = p_shop_id
  ) then
    return jsonb_build_object ('ok', false, 'error', 'account_not_found');
  end if;

  select coalesce (jsonb_agg (row_to_json (x)::jsonb order by x.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      a.id,
      a.reward_id,
      a.status,
      a.expires_at,
      a.created_at,
      a.revoked_at,
      a.note,
      r.name as reward_name,
      r.points_required,
      r.active as reward_active,
      r.expires_on as reward_expires_on,
      r.requires_offer_grant,
      public.loyalty_assignment_active (a.status, a.expires_at, now()) as assignment_usable,
      public.loyalty_reward_unexpired (r.expires_on, now()) as reward_unexpired
    from public.loyalty_reward_assignments a
    join public.loyalty_rewards r on r.id = a.reward_id and r.shop_id = a.shop_id
    where a.shop_id = p_shop_id
      and a.account_id = p_account_id
  ) x;

  return jsonb_build_object ('ok', true, 'assignments', v_rows);
end;
$fn$;

revoke all on function public.loyalty_list_reward_assignments (uuid, uuid) from public;
revoke all on function public.loyalty_list_reward_assignments (uuid, uuid) from anon;
grant execute on function public.loyalty_list_reward_assignments (uuid, uuid) to authenticated;

create or replace function public.loyalty_assign_reward (
  p_shop_id uuid,
  p_account_id uuid,
  p_reward_id uuid,
  p_expires_at timestamptz default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_account public.loyalty_accounts%rowtype;
  v_reward public.loyalty_rewards%rowtype;
  v_existing public.loyalty_reward_assignments%rowtype;
  v_id uuid;
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select * into v_account
  from public.loyalty_accounts
  where id = p_account_id and shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'account_not_found');
  end if;
  if v_account.status = 'revoked' then
    return jsonb_build_object ('ok', false, 'error', 'account_revoked');
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

  -- Prefer existing active row (no duplicate).
  select * into v_existing
  from public.loyalty_reward_assignments
  where shop_id = p_shop_id
    and account_id = p_account_id
    and reward_id = p_reward_id
    and status = 'active'
  for update;
  if found then
    update public.loyalty_reward_assignments
    set expires_at = p_expires_at,
        note = nullif (btrim (coalesce (p_note, note, '')), '')
    where id = v_existing.id
    returning id into v_id;
    return jsonb_build_object (
      'ok', true,
      'assignment_id', v_id,
      'already_assigned', true
    );
  end if;

  -- Reactivate most recent revoked row for same trio if any.
  select * into v_existing
  from public.loyalty_reward_assignments
  where shop_id = p_shop_id
    and account_id = p_account_id
    and reward_id = p_reward_id
    and status = 'revoked'
  order by revoked_at desc nulls last, created_at desc
  limit 1
  for update;
  if found then
    update public.loyalty_reward_assignments
    set status = 'active',
        revoked_at = null,
        expires_at = p_expires_at,
        created_by = auth.uid (),
        note = nullif (btrim (coalesce (p_note, '')), '')
    where id = v_existing.id
    returning id into v_id;
    return jsonb_build_object (
      'ok', true,
      'assignment_id', v_id,
      'reactivated', true
    );
  end if;

  insert into public.loyalty_reward_assignments (
    shop_id, account_id, reward_id, status, expires_at, created_by, note
  )
  values (
    p_shop_id,
    p_account_id,
    p_reward_id,
    'active',
    p_expires_at,
    auth.uid (),
    nullif (btrim (coalesce (p_note, '')), '')
  )
  returning id into v_id;

  return jsonb_build_object (
    'ok', true,
    'assignment_id', v_id,
    'already_assigned', false
  );
exception
  when unique_violation then
    select id into v_id
    from public.loyalty_reward_assignments
    where shop_id = p_shop_id
      and account_id = p_account_id
      and reward_id = p_reward_id
      and status = 'active'
    limit 1;
    return jsonb_build_object (
      'ok', true,
      'assignment_id', v_id,
      'already_assigned', true
    );
end;
$fn$;

revoke all on function public.loyalty_assign_reward (uuid, uuid, uuid, timestamptz, text) from public;
revoke all on function public.loyalty_assign_reward (uuid, uuid, uuid, timestamptz, text) from anon;
grant execute on function public.loyalty_assign_reward (uuid, uuid, uuid, timestamptz, text) to authenticated;

create or replace function public.loyalty_revoke_reward_assignment (
  p_shop_id uuid,
  p_assignment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.loyalty_reward_assignments%rowtype;
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select * into v_row
  from public.loyalty_reward_assignments
  where id = p_assignment_id and shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;
  if v_row.status = 'revoked' then
    return jsonb_build_object ('ok', true, 'already_revoked', true);
  end if;

  update public.loyalty_reward_assignments
  set status = 'revoked',
      revoked_at = now ()
  where id = v_row.id;

  return jsonb_build_object ('ok', true, 'already_revoked', false);
end;
$fn$;

revoke all on function public.loyalty_revoke_reward_assignment (uuid, uuid) from public;
revoke all on function public.loyalty_revoke_reward_assignment (uuid, uuid) from anon;
grant execute on function public.loyalty_revoke_reward_assignment (uuid, uuid) to authenticated;

-- ---------- Redeem: D026 grant OR D029 assignment ----------
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
  if v_account.status = 'revoked' then
    return jsonb_build_object ('ok', false, 'error', 'account_revoked');
  end if;
  if v_account.status = 'suspended' then
    return jsonb_build_object ('ok', false, 'error', 'account_suspended');
  end if;
  if v_account.status <> 'active' then
    return jsonb_build_object ('ok', false, 'error', 'account_disabled');
  end if;
  if not public.loyalty_account_membership_active (v_account.status, v_account.membership_expires_at, now ()) then
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
  if not public.loyalty_reward_unexpired (v_reward.expires_on, now ()) then
    return jsonb_build_object ('ok', false, 'error', 'reward_expired');
  end if;

  -- Decision 026 + 029: grant-only rewards need D026 reward_grant OR active D029 assignment.
  -- Shop-wide rewards (requires_offer_grant=false) keep working without assignment.
  if coalesce (v_reward.requires_offer_grant, false) then
    if not public.loyalty_account_reward_granted (v_account.id, v_reward.id, now ()) then
      if exists (
        select 1
        from public.loyalty_reward_assignments a
        where a.account_id = v_account.id
          and a.reward_id = v_reward.id
          and a.status = 'active'
          and a.expires_at is not null
          and now () >= a.expires_at
      ) then
        return jsonb_build_object ('ok', false, 'error', 'assignment_expired');
      end if;
      return jsonb_build_object ('ok', false, 'error', 'reward_grant_required');
    end if;
  end if;

  perform public.loyalty_expire_due_points (v_account.id);
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

  perform public.loyalty_allocate_fifo (
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
