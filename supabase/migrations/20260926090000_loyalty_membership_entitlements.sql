-- WAKA Loyalty monetisation — Phase 1.
--
-- WAKA Loyalty is an OPTIONAL add-on with its own tiers (free/starter/business/pro),
-- separate from the WAKA POS base subscription. It reuses the EXISTING add-on
-- entitlement mechanism (`organization_feature_entitlements`, created in 038) rather
-- than adding a second billing system, and adds one small catalog table for the
-- tier → member-allowance mapping so tier values are CONFIGURABLE DATA, never
-- hard-coded inside enrollment logic.
--
-- Scope of this migration:
--   1. loyalty_plan_tiers catalog (the configurable entitlement data)
--   2. organization_feature_entitlements widened to carry 'loyalty' + a tier
--   3. server-side resolvers (is Loyalty enabled? which tier? what limit?)
--   4. one authoritative active-member count
--   5. atomic, race-safe enforcement on EVERY loyalty_accounts creation path
--   6. closes the direct-client INSERT/UPDATE hole found in the forensic audit
--
-- Deliberately NOT touched: loyalty_transactions and trg_loyalty_tx_balance (ledger
-- semantics), the points formula, reversals, redemption accounting, void/return
-- logic, Google Wallet signing, WAKA-LOYALTY qr_token semantics.
--
-- Depends on: 038 (organization_feature_entitlements), 076 (shop_org_id),
-- 20260918024500 (loyalty engine), 20260924093000 (loyalty_account_membership_active),
-- 20260924160000 (lifecycle).

-- ============================================================================
-- 1) Tier catalog — configurable entitlement data
-- ============================================================================

create table if not exists public.loyalty_plan_tiers (
  code text primary key
    check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text not null check (btrim(name) <> ''),
  -- Active-member allowance. 0 = no members; null is NOT allowed here so a tier can
  -- never silently mean "unlimited" (a deliberate product choice for this add-on).
  member_limit integer not null check (member_limit >= 0),
  monthly_price_ugx bigint not null default 0 check (monthly_price_ugx >= 0),
  annual_price_ugx bigint not null default 0 check (annual_price_ugx >= 0),
  -- Exactly one tier is the fallback for an org with no explicit tier_code.
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create unique index if not exists loyalty_plan_tiers_one_default
  on public.loyalty_plan_tiers (is_default)
  where is_default;

drop trigger if exists trg_loyalty_plan_tiers_updated on public.loyalty_plan_tiers;
create trigger trg_loyalty_plan_tiers_updated
  before update on public.loyalty_plan_tiers
  for each row execute function public.set_updated_at ();

alter table public.loyalty_plan_tiers enable row level security;

-- Catalog is non-sensitive plan information, readable by any signed-in user
-- (matches `plans_select` on subscription_plans, 008_row_level_security.sql:380).
drop policy if exists loyalty_plan_tiers_select on public.loyalty_plan_tiers;
create policy loyalty_plan_tiers_select
  on public.loyalty_plan_tiers for select
  using (auth.uid () is not null);

revoke all on public.loyalty_plan_tiers from public;
revoke all on public.loyalty_plan_tiers from anon;
grant select on public.loyalty_plan_tiers to authenticated;

-- Initial WAKA Loyalty product catalog. Values are data — change them here, not in code.
insert into public.loyalty_plan_tiers (code, name, member_limit, monthly_price_ugx, annual_price_ugx, is_default, sort_order)
values
  ('free',     'Loyalty Free',     50,     0,      0, true,  1),
  ('starter',  'Loyalty Starter',  500,    20000,  200000, false, 2),
  ('business', 'Loyalty Business', 2000,   50000,  500000, false, 3),
  ('pro',      'Loyalty Pro',      10000,  120000, 1200000, false, 4)
on conflict (code) do nothing;

comment on table public.loyalty_plan_tiers is
  'WAKA Loyalty add-on tiers. member_limit is the active-loyalty-member allowance per shop.';

-- ============================================================================
-- 2) Reuse the EXISTING add-on entitlement table (no second billing system)
-- ============================================================================

-- 2a) Widen the feature_code CHECK to admit 'loyalty' (was 'ai_stock_assistant' only).
do $ffc$
declare
  v_con text;
begin
  select c.conname into v_con
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'organization_feature_entitlements'
    and c.contype = 'c'
    and pg_get_constraintdef (c.oid) ilike '%feature_code%';
  if v_con is not null then
    execute format ('alter table public.organization_feature_entitlements drop constraint %I', v_con);
  end if;
end;
$ffc$;

alter table public.organization_feature_entitlements
  add constraint organization_feature_entitlements_feature_code_check
  check (feature_code in ('ai_stock_assistant', 'loyalty'));

-- 2b) Carry the Loyalty tier on the entitlement row. Nullable so the existing
--     ai_stock_assistant rows are unaffected; Loyalty falls back to the default tier.
alter table public.organization_feature_entitlements
  add column if not exists plan_code text;

do $fk$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'organization_feature_entitlements'
      and c.conname = 'organization_feature_entitlements_plan_code_fk'
  ) then
    alter table public.organization_feature_entitlements
      add constraint organization_feature_entitlements_plan_code_fk
      foreign key (plan_code) references public.loyalty_plan_tiers (code) on delete restrict;
  end if;
end;
$fk$;

comment on column public.organization_feature_entitlements.plan_code is
  'Add-on tier code (currently only used by feature_code=''loyalty''). NULL = default tier.';

-- 2c) Preserve current behaviour for merchants already running Loyalty.
--     Existing shops keep working on the FREE tier rather than being cut off by a
--     new entitlement gate. See "OPEN DECISION" in the Phase 1 report.
insert into public.organization_feature_entitlements (organization_id, feature_code, status, plan_code, approved_at, metadata)
select distinct
  sh.organization_id,
  'loyalty',
  'active',
  'free',
  now (),
  jsonb_build_object ('backfill', 'phase1_preserve_existing_loyalty')
from public.loyalty_programs lp
join public.shops sh on sh.id = lp.shop_id
where lp.enabled = true
on conflict (organization_id, feature_code) do nothing;

-- ============================================================================
-- 3) Resolvers — "is Loyalty enabled?", "which tier?", "what limit?"
-- ============================================================================

-- Entitlement is usable when active, or trialling and not past trial_ends_at.
-- Mirrors _resolve_subscription_base_tier's treatment of trial/expiry.
create or replace function public.loyalty_entitlement_active (
  p_status text,
  p_trial_ends_at timestamptz,
  p_now timestamptz
)
returns boolean
language sql
immutable
as $$
  select case
    when p_status = 'active' then true
    when p_status = 'trial' then (p_trial_ends_at is null or p_now < p_trial_ends_at)
    else false
  end;
$$;

-- Tier code → member allowance, from the catalog. Never hard-coded in enrollment logic.
create or replace function public.loyalty_plan_tier_limit (p_tier_code text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_limit integer;
  v_code text;
begin
  v_code := nullif (lower (btrim (coalesce (p_tier_code, ''))), '');

  if v_code is not null then
    select t.member_limit into v_limit
    from public.loyalty_plan_tiers t
    where t.code = v_code and t.is_active;
    if found then
      return v_limit;
    end if;
  end if;

  -- Unknown / inactive / absent tier falls back to the catalog's default tier.
  select t.member_limit into v_limit
  from public.loyalty_plan_tiers t
  where t.is_default and t.is_active
  limit 1;

  return coalesce (v_limit, 0);
end;
$fn$;

-- Authoritative answer for a shop. Billing is org-scoped (see subscriptions.shop_id
-- comment in 017), so the entitlement is read from the shop's organization, while
-- the allowance itself is enforced per shop — the same shape as device limits.
create or replace function public.resolve_shop_loyalty_entitlement (p_shop_id uuid)
returns table (
  loyalty_enabled boolean,
  entitlement_status text,
  tier_code text,
  tier_name text,
  member_limit integer
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_row public.organization_feature_entitlements%rowtype;
  v_tier text;
  v_now timestamptz := now ();
begin
  if p_shop_id is null then
    return query select false, 'none'::text, null::text, null::text, 0;
    return;
  end if;

  v_org := public.shop_org_id (p_shop_id);
  if v_org is null then
    return query select false, 'none'::text, null::text, null::text, 0;
    return;
  end if;

  select * into v_row
  from public.organization_feature_entitlements e
  where e.organization_id = v_org and e.feature_code = 'loyalty';

  if not found then
    return query select false, 'none'::text, null::text, null::text, 0;
    return;
  end if;

  if not public.loyalty_entitlement_active (v_row.status, v_row.trial_ends_at, v_now) then
    return query select false, v_row.status, null::text, null::text, 0;
    return;
  end if;

  v_tier := nullif (lower (btrim (coalesce (v_row.plan_code, ''))), '');
  if v_tier is null or not exists (
    select 1 from public.loyalty_plan_tiers t where t.code = v_tier and t.is_active
  ) then
    select t.code into v_tier from public.loyalty_plan_tiers t where t.is_default and t.is_active limit 1;
  end if;

  return query
    select
      true,
      v_row.status,
      v_tier,
      (select t.name from public.loyalty_plan_tiers t where t.code = v_tier),
      public.loyalty_plan_tier_limit (v_tier);
end;
$fn$;

-- Advisory-lock seed for the loyalty membership allowance. 0 = device slots
-- (141), 1 = primary device authority (124); seed 2 is claimed here so the
-- membership allowance never serialises against those.
create or replace function public.loyalty_member_limit_lock_key (p_shop_id uuid)
returns bigint
language sql
immutable
as $$
  select hashtextextended (p_shop_id::text, 2);
$$;

-- ============================================================================
-- 4) ONE authoritative active-member count (no drifting client counters)
-- ============================================================================

-- Counts exactly what the existing loyalty engine already treats as an active
-- member: loyalty_account_membership_active(status, membership_expires_at, now).
-- That reuses the repo's existing definition rather than inventing a new one, and
-- automatically excludes suspended, revoked and expired memberships.
create or replace function public.count_shop_active_loyalty_members (p_shop_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.loyalty_accounts a
  where a.shop_id = p_shop_id
    and public.loyalty_account_membership_active (a.status, a.membership_expires_at, now ());
$$;

-- Allowance + current usage in one call, for UI and for enforcement.
create or replace function public.shop_loyalty_usage (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_ent record;
  v_count integer;
begin
  select * into v_ent from public.resolve_shop_loyalty_entitlement (p_shop_id);
  v_count := public.count_shop_active_loyalty_members (p_shop_id);
  return jsonb_build_object (
    'ok', true,
    'loyalty_enabled', v_ent.loyalty_enabled,
    'entitlement_status', v_ent.entitlement_status,
    'tier_code', v_ent.tier_code,
    'tier_name', v_ent.tier_name,
    'member_limit', v_ent.member_limit,
    'active_members', v_count,
    'remaining', greatest (0, coalesce (v_ent.member_limit, 0) - v_count),
    'at_limit', v_ent.loyalty_enabled and v_count >= coalesce (v_ent.member_limit, 0)
  );
end;
$fn$;

-- ============================================================================
-- 5) Enforcement on EVERY loyalty_accounts creation path
-- ============================================================================

-- Backstop BEFORE INSERT guard. This is the only place that can cover all four
-- creation paths found in the audit:
--   A. loyalty_enroll_customer
--   B. loyalty_award_for_sale (implicit account on a completed sale)
--   C. loyalty_enroll_by_enrollment_token (public Edge function)
--   D. a direct client INSERT
--
-- Race-safe by construction: the per-shop advisory lock serialises concurrent
-- inserts for the same shop, so the count-then-insert cannot admit two rows into
-- the final free slot. Matches the proven device pattern in
-- 141_owner_first_device_enrollment.sql:44,175-195.
--
-- Financial isolation: when this raises inside `loyalty_award_for_sale`, the call is
-- already wrapped by trg_loyalty_sales_status's `exception when others then raise
-- warning`, so the SALE STILL SUCCEEDS and only the loyalty side is skipped.
create or replace function public.trg_loyalty_accounts_member_limit ()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ent record;
  v_count integer;
begin
  -- A BEFORE INSERT trigger fires even for a row that `ON CONFLICT (shop_id,
  -- customer_id) DO NOTHING` will discard. Every creation path uses that clause, so
  -- a repeat enroll/award for an existing member must be a no-op here too — it creates
  -- no row, consumes no slot, and must not be rejected at the cap.
  if exists (
    select 1 from public.loyalty_accounts a
    where a.shop_id = new.shop_id and a.customer_id = new.customer_id
  ) then
    return new;
  end if;

  -- Only a row that will actually be an active member consumes an allowance slot.
  if not public.loyalty_account_membership_active (new.status, new.membership_expires_at, now ()) then
    return new;
  end if;

  perform pg_advisory_xact_lock (public.loyalty_member_limit_lock_key (new.shop_id));

  select * into v_ent from public.resolve_shop_loyalty_entitlement (new.shop_id);

  if not v_ent.loyalty_enabled then
    raise exception 'loyalty_not_enabled'
      using errcode = 'P0001',
            detail = format ('shop=%s status=%s', new.shop_id, v_ent.entitlement_status);
  end if;

  v_count := public.count_shop_active_loyalty_members (new.shop_id);

  if coalesce (v_ent.member_limit, 0) <= 0 or v_count >= v_ent.member_limit then
    raise exception 'loyalty_member_limit_reached'
      using errcode = 'P0001',
            detail = format ('shop=%s tier=%s limit=%s active=%s',
                             new.shop_id, v_ent.tier_code, v_ent.member_limit, v_count);
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_loyalty_accounts_member_limit on public.loyalty_accounts;
create trigger trg_loyalty_accounts_member_limit
  before insert on public.loyalty_accounts
  for each row execute function public.trg_loyalty_accounts_member_limit ();

-- ---- A. loyalty_enroll_customer: explicit check for a clean, non-throwing error ----
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
  v_ent record;
  v_count integer;
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not exists (
    select 1 from public.customers where id = p_customer_id and shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'customer_not_in_shop');
  end if;

  -- Loyalty entitlement gate. Only creating a NEW membership consumes a slot;
  -- re-enrolling an existing member stays idempotent and unaffected by the cap.
  select * into v_ent from public.resolve_shop_loyalty_entitlement (p_shop_id);
  if not v_ent.loyalty_enabled then
    return jsonb_build_object(
      'ok', false, 'error', 'loyalty_not_enabled',
      'entitlement_status', v_ent.entitlement_status
    );
  end if;
  if not exists (
    select 1 from public.loyalty_accounts a
    where a.shop_id = p_shop_id and a.customer_id = p_customer_id
  ) then
    perform pg_advisory_xact_lock (public.loyalty_member_limit_lock_key (p_shop_id));
    v_count := public.count_shop_active_loyalty_members (p_shop_id);
    if coalesce (v_ent.member_limit, 0) <= 0 or v_count >= v_ent.member_limit then
      return jsonb_build_object(
        'ok', false, 'error', 'loyalty_member_limit_reached',
        'tier_code', v_ent.tier_code,
        'member_limit', v_ent.member_limit,
        'active_count', v_count
      );
    end if;
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
    if v_account.status = 'revoked' then
      return jsonb_build_object(
        'ok', false,
        'error', 'account_revoked',
        'account_id', v_account.id,
        'purge_after', v_account.purge_after
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'account_id', v_account.id,
    'qr_token', v_account.qr_token,
    'already_enrolled', not v_new,
    'status', v_account.status,
    'membership_expires_at', v_account.membership_expires_at,
    'membership_active', public.loyalty_account_membership_active(
      v_account.status, v_account.membership_expires_at, now ()
    )
  );
end;
$function$;

-- ============================================================================
-- 6) Security fix — close the direct client write path on loyalty_accounts
-- ============================================================================
-- The audit found `grant insert on public.loyalty_accounts to authenticated`
-- (20260918024500:604) never revoked, with policy `loyalty_accounts_write`
-- admitting any `user_is_cashier_or_above` caller. That let a client POST arbitrary
-- balance_points / status / qr_token / public_card_token with no ledger row, and
-- would have bypassed the member allowance above.
--
-- No client code writes this table (every `from("loyalty_accounts")` in src/ is a
-- select), and every server path is a SECURITY DEFINER function owned by the same
-- role as the table, so definer writes are unaffected: the table owner bypasses RLS
-- (it does not use FORCE ROW LEVEL SECURITY, unlike loyalty_enrollment_links).
revoke insert on public.loyalty_accounts from authenticated;
revoke update on public.loyalty_accounts from authenticated;
revoke insert on public.loyalty_accounts from anon;
revoke update on public.loyalty_accounts from anon;

-- Belt and braces: remove the INSERT policy so a future accidental re-grant cannot
-- silently reopen the path. Anon stays fully revoked; shop isolation is unchanged.
drop policy if exists loyalty_accounts_write on public.loyalty_accounts;

-- ============================================================================
-- 7) Grants for the new resolver surface
-- ============================================================================
do $gr$
begin
  execute 'revoke all on function public.loyalty_entitlement_active (text, timestamptz, timestamptz) from public';
  execute 'revoke all on function public.loyalty_entitlement_active (text, timestamptz, timestamptz) from anon';
  execute 'grant execute on function public.loyalty_entitlement_active (text, timestamptz, timestamptz) to authenticated';

  execute 'revoke all on function public.loyalty_plan_tier_limit (text) from public';
  execute 'revoke all on function public.loyalty_plan_tier_limit (text) from anon';
  execute 'grant execute on function public.loyalty_plan_tier_limit (text) to authenticated';

  execute 'revoke all on function public.resolve_shop_loyalty_entitlement (uuid) from public';
  execute 'revoke all on function public.resolve_shop_loyalty_entitlement (uuid) from anon';
  execute 'grant execute on function public.resolve_shop_loyalty_entitlement (uuid) to authenticated';

  execute 'revoke all on function public.shop_loyalty_usage (uuid) from public';
  execute 'revoke all on function public.shop_loyalty_usage (uuid) from anon';
  execute 'grant execute on function public.shop_loyalty_usage (uuid) to authenticated';

  execute 'revoke all on function public.loyalty_member_limit_lock_key (uuid) from public';
  execute 'revoke all on function public.loyalty_member_limit_lock_key (uuid) from anon';
  execute 'revoke all on function public.loyalty_member_limit_lock_key (uuid) from authenticated';

  -- Internal primitives stay server-only.
  execute 'revoke all on function public.count_shop_active_loyalty_members (uuid) from public';
  execute 'revoke all on function public.count_shop_active_loyalty_members (uuid) from anon';
  execute 'grant execute on function public.count_shop_active_loyalty_members (uuid) to authenticated';

  execute 'revoke all on function public.trg_loyalty_accounts_member_limit () from public';
  execute 'revoke all on function public.trg_loyalty_accounts_member_limit () from anon';
  execute 'revoke all on function public.trg_loyalty_accounts_member_limit () from authenticated';
end;
$gr$;

-- ============================================================================
-- 8) loyalty_award_for_sale - allowance gate on the implicit-enrollment branch
-- ============================================================================
-- Body reproduced verbatim from 20260924160000_loyalty_customer_lifecycle.sql:585-719
-- with exactly two additions: the `v_ent record;` declaration and the gate block
-- above the account insert. The points formula, offer composition, ledger snapshot,
-- idempotency handling and reversal call are byte-for-byte unchanged.
--
-- Behaviour when the allowance is full (requirement 5): this RETURNS
-- {ok:true, awarded:false, reason:"loyalty_limit_reached"} instead of raising, so:
--   - the sale is unaffected (it was already committed before this trigger fires),
--   - no loyalty account is created, no points are awarded,
--   - the sales trigger never sees an exception, so nothing is swallowed silently.
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
  v_ent record;
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

  -- WAKA Loyalty Phase 1 - membership allowance gate.
  -- Only the implicit CREATE of a new membership consumes a slot; awarding to an
  -- existing member is unaffected by the limit. This RETURNS rather than raising,
  -- so the financial sale is untouched either way. The BEFORE INSERT backstop
  -- trg_loyalty_accounts_member_limit covers the concurrent race.
  if not exists (
    select 1 from public.loyalty_accounts a
    where a.shop_id = v_sale.shop_id and a.customer_id = v_sale.customer_id
  ) then
    select * into v_ent from public.resolve_shop_loyalty_entitlement (v_sale.shop_id);
    if not v_ent.loyalty_enabled then
      return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'loyalty_not_enabled');
    end if;
    if coalesce (v_ent.member_limit, 0) <= 0
       or public.count_shop_active_loyalty_members (v_sale.shop_id) >= v_ent.member_limit then
      return jsonb_build_object(
        'ok', true, 'awarded', false, 'reason', 'loyalty_limit_reached',
        'tier_code', v_ent.tier_code, 'member_limit', v_ent.member_limit
      );
    end if;
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

  if v_account.status = 'revoked' then
    return jsonb_build_object(
      'ok', true, 'awarded', false, 'reason', 'account_revoked', 'account_id', v_account_id
    );
  end if;
  if v_account.status = 'suspended' then
    return jsonb_build_object(
      'ok', true, 'awarded', false, 'reason', 'account_suspended', 'account_id', v_account_id
    );
  end if;
  if not public.loyalty_account_membership_active(v_account.status, v_account.membership_expires_at, now()) then
    return jsonb_build_object(
      'ok', true, 'awarded', false, 'reason', 'membership_expired', 'account_id', v_account_id
    );
  end if;

  v_eligible := greatest (v_sale.total_ugx - v_program.min_eligible_spend_ugx, 0);
  v_base := ((v_eligible / v_program.earn_unit_ugx) * v_program.earn_points_per_unit)::integer;

  v_offers := public.loyalty_resolve_customer_offers(v_account_id, now());
  if coalesce((v_offers ->> 'ok')::boolean, false) is not true then
    v_offers := public.loyalty_empty_offer_resolution(now());
  end if;

  v_points := public.loyalty_compose_offer_points(v_base, v_offers);

  if v_points <= 0 then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'below_threshold', 'account_id', v_account_id);
  end if;

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
