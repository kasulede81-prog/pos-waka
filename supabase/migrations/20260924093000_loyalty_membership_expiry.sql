-- C1 — Merchant-controlled loyalty MEMBERSHIP expiry (not points expiry).
--
-- Default safety: mode='never', membership_expires_at NULL for all existing rows.
-- Changing the program rule does NOT rewrite existing accounts.
-- New enrollments / first-award inserts stamp expires_at from the current rule.
--
-- Expiry semantics: Africa/Kampala calendar day, inclusive through end of that day.
-- Authoritative comparisons use server now().
-- Does NOT touch sales/payments/inventory or burn points.

-- ---------- Schema ----------
alter table public.loyalty_programs
  add column if not exists membership_expiry_mode text not null default 'never',
  add column if not exists membership_fixed_expires_on date null,
  add column if not exists membership_duration_months integer null;

do $chk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loyalty_programs_membership_expiry_mode_chk'
      and conrelid = 'public.loyalty_programs'::regclass
  ) then
    alter table public.loyalty_programs
      add constraint loyalty_programs_membership_expiry_mode_chk
      check (membership_expiry_mode in ('never', 'fixed_date', 'duration'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'loyalty_programs_membership_duration_chk'
      and conrelid = 'public.loyalty_programs'::regclass
  ) then
    alter table public.loyalty_programs
      add constraint loyalty_programs_membership_duration_chk
      check (
        membership_duration_months is null
        or membership_duration_months > 0
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'loyalty_programs_membership_rule_shape_chk'
      and conrelid = 'public.loyalty_programs'::regclass
  ) then
    alter table public.loyalty_programs
      add constraint loyalty_programs_membership_rule_shape_chk
      check (
        (
          membership_expiry_mode = 'never'
          and membership_fixed_expires_on is null
          and membership_duration_months is null
        )
        or (
          membership_expiry_mode = 'fixed_date'
          and membership_fixed_expires_on is not null
          and membership_duration_months is null
        )
        or (
          membership_expiry_mode = 'duration'
          and membership_duration_months is not null
          and membership_fixed_expires_on is null
        )
      );
  end if;
end;
$chk$;

comment on column public.loyalty_programs.membership_expiry_mode is
  'C1 membership rule for NEW enrollments only: never | fixed_date | duration. Does not rewrite existing accounts.';

alter table public.loyalty_accounts
  add column if not exists membership_expires_at timestamptz null;

comment on column public.loyalty_accounts.membership_expires_at is
  'Exclusive upper bound (start of next Kampala day after inclusive expiry date). NULL = never expires.';

create index if not exists loyalty_accounts_shop_membership_expires_idx
  on public.loyalty_accounts (shop_id, membership_expires_at);

-- ---------- Helpers (Kampala end-of-day / exclusive upper bound) ----------
-- Active through calendar date D (Kampala) inclusive ⇔ now() < (D+1) AT TIME ZONE Africa/Kampala
create or replace function public.loyalty_membership_expires_at_from_date (p_date date)
returns timestamptz
language sql
immutable
as $fn$
  select case
    when p_date is null then null
    else ((p_date + 1)::timestamp at time zone 'Africa/Kampala')
  end;
$fn$;

create or replace function public.loyalty_membership_expires_on_date (p_expires_at timestamptz)
returns date
language sql
immutable
as $fn$
  -- Inverse of exclusive upper bound → last inclusive Kampala calendar day.
  select case
    when p_expires_at is null then null
    else (timezone('Africa/Kampala', p_expires_at) - interval '1 day')::date
  end;
$fn$;

create or replace function public.loyalty_compute_membership_expires_at (
  p_mode text,
  p_fixed_on date,
  p_duration_months integer,
  p_from timestamptz default now()
)
returns timestamptz
language plpgsql
stable
as $fn$
declare
  v_mode text := lower(btrim(coalesce(p_mode, 'never')));
  v_from timestamptz := coalesce(p_from, now());
  v_start_date date;
  v_end_date date;
begin
  if v_mode = 'never' or v_mode = '' then
    return null;
  end if;

  if v_mode = 'fixed_date' then
    if p_fixed_on is null then
      return null;
    end if;
    return public.loyalty_membership_expires_at_from_date(p_fixed_on);
  end if;

  if v_mode = 'duration' then
    if p_duration_months is null or p_duration_months <= 0 then
      return null;
    end if;
    v_start_date := timezone('Africa/Kampala', v_from)::date;
    v_end_date := (v_start_date + make_interval(months => p_duration_months))::date;
    return public.loyalty_membership_expires_at_from_date(v_end_date);
  end if;

  return null;
end;
$fn$;

create or replace function public.loyalty_account_membership_active (
  p_status text,
  p_expires_at timestamptz,
  p_now timestamptz default now()
)
returns boolean
language sql
stable
as $fn$
  select coalesce(p_status, '') = 'active'
    and (p_expires_at is null or coalesce(p_now, now()) < p_expires_at);
$fn$;

revoke all on function public.loyalty_membership_expires_at_from_date (date) from public;
revoke all on function public.loyalty_membership_expires_on_date (timestamptz) from public;
revoke all on function public.loyalty_compute_membership_expires_at (text, date, integer, timestamptz) from public;
revoke all on function public.loyalty_account_membership_active (text, timestamptz, timestamptz) from public;
grant execute on function public.loyalty_membership_expires_at_from_date (date) to authenticated;
grant execute on function public.loyalty_membership_expires_on_date (timestamptz) to authenticated;
grant execute on function public.loyalty_compute_membership_expires_at (text, date, integer, timestamptz) to authenticated;
grant execute on function public.loyalty_account_membership_active (text, timestamptz, timestamptz) to authenticated;

-- Stamp only when inserting a brand-new account (expires_at still null).
create or replace function public.loyalty_stamp_new_account_membership (
  p_account_id uuid,
  p_shop_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_program public.loyalty_programs%rowtype;
  v_expires timestamptz;
begin
  select * into v_program from public.loyalty_programs where shop_id = p_shop_id;
  if not found then
    return;
  end if;

  v_expires := public.loyalty_compute_membership_expires_at (
    v_program.membership_expiry_mode,
    v_program.membership_fixed_expires_on,
    v_program.membership_duration_months,
    now()
  );

  update public.loyalty_accounts
  set membership_expires_at = v_expires
  where id = p_account_id
    and shop_id = p_shop_id
    and membership_expires_at is null;
end;
$fn$;

revoke all on function public.loyalty_stamp_new_account_membership (uuid, uuid) from public;
revoke all on function public.loyalty_stamp_new_account_membership (uuid, uuid) from anon;
revoke all on function public.loyalty_stamp_new_account_membership (uuid, uuid) from authenticated;

-- ---------- Overview ----------
create or replace function public.loyalty_shop_overview (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select jsonb_build_object(
    'ok', true,
    'program', (
      select jsonb_build_object(
        'enabled', p.enabled,
        'earn_unit_ugx', p.earn_unit_ugx,
        'earn_points_per_unit', p.earn_points_per_unit,
        'min_eligible_spend_ugx', p.min_eligible_spend_ugx,
        'rule_kind', p.rule_kind,
        'membership_expiry_mode', p.membership_expiry_mode,
        'membership_fixed_expires_on', p.membership_fixed_expires_on,
        'membership_duration_months', p.membership_duration_months,
        'updated_at', p.updated_at
      )
      from public.loyalty_programs p
      where p.shop_id = p_shop_id
    ),
    'members_total', (
      select count(*) from public.loyalty_accounts a where a.shop_id = p_shop_id
    ),
    'members_active', (
      select count(*) from public.loyalty_accounts a
      where a.shop_id = p_shop_id
        and public.loyalty_account_membership_active(a.status, a.membership_expires_at, now())
    ),
    'points_issued', (
      select coalesce(sum(t.points), 0)
      from public.loyalty_transactions t
      where t.shop_id = p_shop_id and t.points > 0
    ),
    'points_redeemed', (
      select coalesce(-sum(t.points), 0)
      from public.loyalty_transactions t
      where t.shop_id = p_shop_id and t.kind in ('redeemed', 'expired')
    ),
    'points_reversed', (
      select coalesce(-sum(t.points), 0)
      from public.loyalty_transactions t
      where t.shop_id = p_shop_id and t.kind = 'reversed'
    ),
    'recent_activity', (
      select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb)
      from (
        select
          t.id, t.account_id, t.kind, t.points, t.balance_after, t.cause, t.note,
          t.created_at, c.name as customer_name
        from public.loyalty_transactions t
        join public.loyalty_accounts a on a.id = t.account_id
        join public.customers c on c.id = a.customer_id
        where t.shop_id = p_shop_id
        order by t.created_at desc
        limit 10
      ) x
    )
  )
  into v_result;

  return v_result;
end;
$function$;

-- ---------- Program update (new membership args; drop old 5-arg overload) ----------
drop function if exists public.loyalty_update_program (uuid, boolean, bigint, integer, bigint);

create or replace function public.loyalty_update_program (
  p_shop_id uuid,
  p_enabled boolean,
  p_earn_unit_ugx bigint,
  p_earn_points_per_unit integer,
  p_min_eligible_spend_ugx bigint,
  p_membership_expiry_mode text default 'never',
  p_membership_fixed_expires_on date default null,
  p_membership_duration_months integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_mode text := lower(btrim(coalesce(p_membership_expiry_mode, 'never')));
  v_fixed date := p_membership_fixed_expires_on;
  v_months integer := p_membership_duration_months;
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_earn_unit_ugx is null or p_earn_unit_ugx <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_earn_unit');
  end if;
  if p_earn_points_per_unit is null or p_earn_points_per_unit <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_points_per_unit');
  end if;
  if p_min_eligible_spend_ugx is null or p_min_eligible_spend_ugx < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_min_spend');
  end if;

  if v_mode not in ('never', 'fixed_date', 'duration') then
    return jsonb_build_object('ok', false, 'error', 'invalid_membership_mode');
  end if;

  if v_mode = 'never' then
    v_fixed := null;
    v_months := null;
  elsif v_mode = 'fixed_date' then
    if v_fixed is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_membership_fixed_date');
    end if;
    v_months := null;
  elsif v_mode = 'duration' then
    if v_months is null or v_months <= 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_membership_duration');
    end if;
    v_fixed := null;
  end if;

  insert into public.loyalty_programs (
    shop_id, enabled, earn_unit_ugx, earn_points_per_unit, min_eligible_spend_ugx,
    membership_expiry_mode, membership_fixed_expires_on, membership_duration_months
  )
  values (
    p_shop_id, coalesce(p_enabled, false), p_earn_unit_ugx,
    p_earn_points_per_unit, p_min_eligible_spend_ugx,
    v_mode, v_fixed, v_months
  )
  on conflict (shop_id) do update
  set enabled = coalesce(p_enabled, false),
      earn_unit_ugx = p_earn_unit_ugx,
      earn_points_per_unit = p_earn_points_per_unit,
      min_eligible_spend_ugx = p_min_eligible_spend_ugx,
      membership_expiry_mode = v_mode,
      membership_fixed_expires_on = v_fixed,
      membership_duration_months = v_months;
  -- Intentionally does NOT update loyalty_accounts.membership_expires_at.

  return jsonb_build_object('ok', true);
end;
$function$;

grant execute on function public.loyalty_update_program (
  uuid, boolean, bigint, integer, bigint, text, date, integer
) to authenticated;

-- ---------- Search accounts (+ membership fields) ----------
create or replace function public.loyalty_search_accounts (
  p_shop_id uuid,
  p_query text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'accounts', coalesce((
      select jsonb_agg(row_to_json(x) order by x.customer_name)
      from (
        select
          a.id,
          a.customer_id,
          a.status,
          a.balance_points,
          a.lifetime_earned_points,
          a.lifetime_redeemed_points,
          a.enrolled_at,
          a.membership_expires_at,
          public.loyalty_account_membership_active(a.status, a.membership_expires_at, now()) as membership_active,
          public.loyalty_membership_expires_on_date(a.membership_expires_at) as membership_expires_on,
          c.name as customer_name,
          c.phone_e164 as customer_phone
        from public.loyalty_accounts a
        join public.customers c on c.id = a.customer_id
        where a.shop_id = p_shop_id
          and (
            p_query is null
            or btrim(p_query) = ''
            or c.name ilike '%' || btrim(p_query) || '%'
            or c.phone_e164 ilike '%' || btrim(p_query) || '%'
          )
        limit v_limit
      ) x
    ), '[]'::jsonb)
  );
end;
$function$;

-- ---------- Token lookup (+ membership) ----------
create or replace function public.loyalty_account_by_token (
  p_shop_id uuid,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_account public.loyalty_accounts%rowtype;
  v_customer public.customers%rowtype;
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'error', 'token_required');
  end if;

  select * into v_account
  from public.loyalty_accounts
  where shop_id = p_shop_id and qr_token = btrim(p_token);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_customer from public.customers where id = v_account.customer_id;

  return jsonb_build_object(
    'ok', true,
    'account_id', v_account.id,
    'customer_id', v_account.customer_id,
    'customer_name', v_customer.name,
    'customer_phone', v_customer.phone_e164,
    'status', v_account.status,
    'balance_points', v_account.balance_points,
    'qr_token', v_account.qr_token,
    'membership_expires_at', v_account.membership_expires_at,
    'membership_active', public.loyalty_account_membership_active(
      v_account.status, v_account.membership_expires_at, now()
    ),
    'membership_expires_on', public.loyalty_membership_expires_on_date(v_account.membership_expires_at)
  );
end;
$function$;

-- ---------- Enroll: stamp new accounts only ----------
create or replace function public.loyalty_enroll_customer (
  p_shop_id uuid,
  p_customer_id uuid,
  p_consent_accepted boolean default false,
  p_consent_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_account_id uuid;
  v_account public.loyalty_accounts%rowtype;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_new boolean := false;
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not exists (
    select 1 from public.customers where id = p_customer_id and shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'customer_not_in_shop');
  end if;
  if coalesce(p_consent_accepted, false) then
    v_metadata := v_metadata || jsonb_build_object(
      'consent', jsonb_build_object(
        'accepted', true,
        'accepted_at', now (),
        'accepted_by', auth.uid (),
        'note', nullif(btrim(coalesce(p_consent_note, '')), '')
      )
    );
  end if;

  insert into public.loyalty_accounts (shop_id, customer_id, enrolled_by, metadata)
  values (p_shop_id, p_customer_id, auth.uid (), v_metadata)
  on conflict (shop_id, customer_id) do nothing
  returning id into v_account_id;

  if v_account_id is not null then
    v_new := true;
    perform public.loyalty_stamp_new_account_membership(v_account_id, p_shop_id);
    select * into v_account from public.loyalty_accounts where id = v_account_id;
  else
    select * into v_account
    from public.loyalty_accounts
    where shop_id = p_shop_id and customer_id = p_customer_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'account_id', v_account.id,
    'qr_token', v_account.qr_token,
    'already_enrolled', not v_new,
    'membership_expires_at', v_account.membership_expires_at,
    'membership_active', public.loyalty_account_membership_active(
      v_account.status, v_account.membership_expires_at, now()
    )
  );
end;
$function$;

-- ---------- Award: stamp new; block earn when membership expired ----------
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
  v_points integer;
  v_eligible bigint;
  v_new boolean := false;
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

  if not public.loyalty_account_membership_active(v_account.status, v_account.membership_expires_at, now()) then
    return jsonb_build_object(
      'ok', true,
      'awarded', false,
      'reason', 'membership_expired',
      'account_id', v_account_id
    );
  end if;

  v_eligible := greatest (v_sale.total_ugx - v_program.min_eligible_spend_ugx, 0);
  v_points := (v_eligible / v_program.earn_unit_ugx) * v_program.earn_points_per_unit;

  if v_points <= 0 then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'below_threshold', 'account_id', v_account_id);
  end if;

  begin
    insert into public.loyalty_transactions (
      shop_id, account_id, kind, points, cause, source_sale_id,
      rule_snapshot, actor, actor_source
    )
    values (
      v_sale.shop_id, v_account_id, 'earned', v_points, 'sale', v_sale.id,
      jsonb_build_object(
        'rule_kind', v_program.rule_kind,
        'earn_unit_ugx', v_program.earn_unit_ugx,
        'earn_points_per_unit', v_program.earn_points_per_unit,
        'eligible_spend_ugx', v_eligible
      ),
      auth.uid (), 'system'
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
    'transaction_id', v_tx_id,
    'account_id', v_account_id,
    'new_account', v_new
  );
end;
$function$;

revoke all on function public.loyalty_award_for_sale (uuid) from public;
revoke all on function public.loyalty_award_for_sale (uuid) from anon;
revoke all on function public.loyalty_award_for_sale (uuid) from authenticated;

-- ---------- Redeem: membership check after FOR UPDATE ----------
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
  if not v_reward.active then
    return jsonb_build_object ('ok', false, 'error', 'reward_inactive');
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

-- ---------- Renewal (manage-shop only; updates expires_at only) ----------
create or replace function public.loyalty_renew_membership (
  p_shop_id uuid,
  p_account_id uuid,
  p_mode text default null,
  p_fixed_expires_on date default null,
  p_duration_months integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_account public.loyalty_accounts%rowtype;
  v_program public.loyalty_programs%rowtype;
  v_mode text;
  v_fixed date;
  v_months integer;
  v_expires timestamptz;
  v_token text;
  v_balance integer;
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_account
  from public.loyalty_accounts
  where id = p_account_id and shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;

  v_token := v_account.public_card_token;
  v_balance := v_account.balance_points;

  if p_mode is null or btrim(p_mode) = '' then
    select * into v_program from public.loyalty_programs where shop_id = p_shop_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'program_not_found');
    end if;
    v_mode := v_program.membership_expiry_mode;
    v_fixed := v_program.membership_fixed_expires_on;
    v_months := v_program.membership_duration_months;
  else
    v_mode := lower(btrim(p_mode));
    v_fixed := p_fixed_expires_on;
    v_months := p_duration_months;
  end if;

  if v_mode not in ('never', 'fixed_date', 'duration') then
    return jsonb_build_object('ok', false, 'error', 'invalid_membership_mode');
  end if;
  if v_mode = 'fixed_date' and v_fixed is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_membership_fixed_date');
  end if;
  if v_mode = 'duration' and (v_months is null or v_months <= 0) then
    return jsonb_build_object('ok', false, 'error', 'invalid_membership_duration');
  end if;

  v_expires := public.loyalty_compute_membership_expires_at(v_mode, v_fixed, v_months, now());

  update public.loyalty_accounts
  set membership_expires_at = v_expires
  where id = v_account.id
    and shop_id = p_shop_id;

  select * into v_account from public.loyalty_accounts where id = p_account_id;

  -- Invariants: token and balance must be unchanged by this RPC.
  if v_account.public_card_token is distinct from v_token
     or v_account.balance_points is distinct from v_balance then
    raise exception 'loyalty_renew_membership mutated token or balance';
  end if;

  return jsonb_build_object(
    'ok', true,
    'account_id', v_account.id,
    'membership_expires_at', v_account.membership_expires_at,
    'membership_expires_on', public.loyalty_membership_expires_on_date(v_account.membership_expires_at),
    'membership_active', public.loyalty_account_membership_active(
      v_account.status, v_account.membership_expires_at, now()
    ),
    'balance_points', v_account.balance_points
  );
end;
$function$;

revoke all on function public.loyalty_renew_membership (uuid, uuid, text, date, integer) from public;
revoke all on function public.loyalty_renew_membership (uuid, uuid, text, date, integer) from anon;
grant execute on function public.loyalty_renew_membership (uuid, uuid, text, date, integer) to authenticated;
