-- ============================================================================
-- M3-G — PROVIDER ALLOWLIST + INITIATION CLAIM (double-initiate & pre-attach)
-- ============================================================================
-- Three M3-G findings addressed in one place (the later function bodies
-- supersede M3-A/M3-C/M3-E, so they are re-created together to avoid
-- whack-a-mole overrides):
--
-- 1. PROVIDER ALLOWLIST (audit F2, PROVEN): `provider` was client-authored
--    with only a regex shape check — no server-side allowlist existed at any
--    layer. Now every write path (create, claim, attach) validates the
--    provider against an explicit server allowlist. 'pesapal' is included as
--    a FUTURE provider id only: no adapter, no credentials, no API — the
--    adapter registry is still empty, so initiate still fails closed with
--    provider_not_configured.
--
-- 2. CONCURRENT DOUBLE-INITIATE (audit F1, mechanism PROVEN): payment-initiate
--    read metadata.initiated_at, then called the provider, then attached —
--    with no lock in between, so two simultaneous requests could both start
--    provider transactions. NEW `subscription_payment_provider_claim` takes a
--    row-locked claim BEFORE the provider call:
--      * first caller  → claimed:true (proceeds to the provider)
--      * second caller → claimed:false + in_progress (provider NOT called)
--      * already attached → already_initiated (idempotent observation)
--      * crashed claim → reclaimable after the TTL (default 300 s), so a dead
--        request cannot brick the payment.
--
-- 3. PRE-ATTACH WINDOW (audit F4, mechanism PROVEN): between provider accept
--    and attach writing initiated_at, a concurrent create could stale-replace
--    the in-flight payment. The stale-replace predicate now also skips rows
--    whose claim is FRESH (≤ 300 s old), so an in-flight initiation can never
--    be cancelled. RESIDUAL (isolated, not claimed solved): a claim older
--    than the TTL with no attach (crash after provider accept) is still
--    replaceable; full closure depends on provider idempotency semantics
--    (PesaPal must dedupe by OUR reference) — PROVIDER-DEPENDENT-UNKNOWN.
--
-- M3-C/E remain provider-agnostic: this file contains no provider API logic.

-- ---------------------------------------------------------------------------
-- 1. Server-side provider allowlist
-- ---------------------------------------------------------------------------
create or replace function public.subscription_payment_provider_allowed (p_provider text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower (nullif (trim (coalesce (p_provider, '')), '')) in (
    'manual',        -- legacy manual rows
    'manual_admin',  -- admin_subscription_mark_payment
    'mtn_momo',      -- registered provider (adapter not yet configured)
    'airtel_money',  -- registered provider (adapter not yet configured)
    'pesapal'        -- FUTURE provider id — label only, no adapter exists
  );
$$;

revoke all on function public.subscription_payment_provider_allowed (text) from public;
revoke all on function public.subscription_payment_provider_allowed (text) from anon;
grant execute on function public.subscription_payment_provider_allowed (text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Initiation claim (taken by payment-initiate BEFORE the provider call)
-- ---------------------------------------------------------------------------
create or replace function public.subscription_payment_provider_claim (
  p_payment_id uuid,
  p_claim_ttl_seconds int default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_ttl int := greatest (coalesce (p_claim_ttl_seconds, 300), 30);
  v_claim_at timestamptz;
begin
  select sp.id,
         sp.subscription_id,
         sp.organization_id,
         sp.status,
         sp.provider,
         sp.metadata
    into v_payment
  from public.subscription_payments sp
  where sp.id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'payment_not_found');
  end if;

  if not public._subscription_payment_can_settle (v_payment.organization_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if not public.subscription_payment_provider_allowed (v_payment.provider) then
    return jsonb_build_object ('ok', false, 'error', 'provider_not_allowed');
  end if;

  if v_payment.status <> 'pending' then
    return jsonb_build_object (
      'ok', false,
      'error', 'payment_not_pending',
      'status', v_payment.status
    );
  end if;

  -- Already attached: idempotent observation, never a second claim.
  if nullif (v_payment.metadata ->> 'initiated_at', '') is not null then
    return jsonb_build_object (
      'ok', true,
      'claimed', false,
      'already_initiated', true,
      'payment_id', v_payment.id,
      'status', 'pending',
      'provider_reference', nullif (v_payment.metadata ->> 'provider_reference', '')
    );
  end if;

  v_claim_at := nullif (v_payment.metadata ->> 'initiate_claimed_at', '')::timestamptz;

  if v_claim_at is not null and v_claim_at > now () - make_interval (secs => v_ttl) then
    -- Fresh claim held by a concurrent request: the provider must NOT be
    -- called again by this one.
    return jsonb_build_object (
      'ok', true,
      'claimed', false,
      'in_progress', true,
      'payment_id', v_payment.id,
      'status', 'pending'
    );
  end if;

  update public.subscription_payments sp
  set metadata = coalesce (sp.metadata, '{}'::jsonb)
    || jsonb_build_object ('initiate_claimed_at', now ()::text)
  where sp.id = v_payment.id;

  return jsonb_build_object (
    'ok', true,
    'claimed', true,
    'payment_id', v_payment.id,
    'status', 'pending'
  );
exception
  when invalid_text_representation then
    -- Malformed claim timestamp in metadata: treat as stale and re-claim.
    update public.subscription_payments sp
    set metadata = coalesce (sp.metadata, '{}'::jsonb)
      || jsonb_build_object ('initiate_claimed_at', now ()::text)
    where sp.id = p_payment_id and sp.status = 'pending';
    return jsonb_build_object (
      'ok', true,
      'claimed', true,
      'payment_id', p_payment_id,
      'status', 'pending'
    );
end;
$$;

revoke all on function public.subscription_payment_provider_claim (uuid, int) from public;
revoke all on function public.subscription_payment_provider_claim (uuid, int) from anon;
grant execute on function public.subscription_payment_provider_claim (uuid, int) to authenticated;

do $service$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.subscription_payment_provider_claim (uuid, int) to service_role';
  end if;
end;
$service$;

-- ---------------------------------------------------------------------------
-- 3. provider_attach — re-created with the allowlist check
--     (M3-C body otherwise byte-identical)
-- ---------------------------------------------------------------------------
create or replace function public.subscription_payment_provider_attach (
  p_payment_id uuid,
  p_provider_reference text default null,
  p_phone text default null,
  p_initiated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_ref text := nullif (trim (coalesce (p_provider_reference, '')), '');
  v_phone text := nullif (trim (coalesce (p_phone, '')), '');
  v_at timestamptz := coalesce (p_initiated_at, now ());
  v_existing_ref text;
  v_initiated boolean;
begin
  select sp.id,
         sp.subscription_id,
         sp.organization_id,
         sp.status,
         sp.provider,
         sp.metadata
    into v_payment
  from public.subscription_payments sp
  where sp.id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'payment_not_found');
  end if;

  if not public._subscription_payment_can_settle (v_payment.organization_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  -- M3-G allowlist: a row whose provider is not server-registered can never
  -- be linked to a provider transaction.
  if not public.subscription_payment_provider_allowed (v_payment.provider) then
    return jsonb_build_object ('ok', false, 'error', 'provider_not_allowed');
  end if;

  if v_payment.status <> 'pending' then
    return jsonb_build_object (
      'ok', false,
      'error', 'payment_not_pending',
      'status', v_payment.status
    );
  end if;

  -- Bounded, provider-agnostic shapes (our own charset — not a provider spec).
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_phone');
  end if;
  if v_ref is not null and v_ref !~ '^[A-Za-z0-9._:-]{1,128}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_provider_reference');
  end if;

  v_existing_ref := nullif (v_payment.metadata ->> 'provider_reference', '');
  v_initiated := (v_payment.metadata ->> 'initiated_at') is not null or v_existing_ref is not null;

  if v_initiated then
    if v_ref is not null and v_existing_ref is not null and v_existing_ref <> v_ref then
      return jsonb_build_object ('ok', false, 'error', 'provider_reference_conflict');
    end if;
    return jsonb_build_object (
      'ok', true,
      'idempotent', true,
      'payment_id', v_payment.id,
      'status', 'pending',
      'provider_reference', v_existing_ref
    );
  end if;

  update public.subscription_payments sp
  set metadata = coalesce (sp.metadata, '{}'::jsonb)
    || jsonb_strip_nulls (jsonb_build_object (
         'provider_reference', v_ref,
         'phone', v_phone
       ))
    || jsonb_build_object ('initiated_at', v_at, 'initiated_via', 'payment_initiate')
  where sp.id = v_payment.id;

  perform public._internal_subscription_history_write (
    v_payment.subscription_id,
    'payment_initiated',
    'Provider payment initiated',
    jsonb_build_object (
      'payment_id', v_payment.id,
      'provider', v_payment.provider,
      'provider_reference', v_ref,
      'initiated_at', v_at,
      'status', 'pending'
    )
  );

  perform public._subscription_payment_audit (
    v_payment.subscription_id,
    'subscription_payment_provider_attach',
    'Provider payment initiated',
    jsonb_build_object (
      'payment_id', v_payment.id,
      'provider', v_payment.provider,
      'provider_reference', v_ref,
      'initiated_at', v_at
    )
  );

  return jsonb_build_object (
    'ok', true,
    'idempotent', false,
    'payment_id', v_payment.id,
    'status', 'pending',
    'provider_reference', v_ref
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. subscription_payment_create — M3-E body + allowlist + claim-aware guard
-- ---------------------------------------------------------------------------
create or replace function public.subscription_payment_create (
  p_shop_id uuid,
  p_provider text,
  p_reference text default null,
  p_amount_ugx bigint default null,
  p_note text default null,
  p_payment_id uuid default null,
  p_subscription_id uuid default null,
  p_plan_code text default null,
  p_billing_cycle text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := coalesce (p_payment_id, gen_random_uuid ());
  v_provider text := lower (nullif (trim (coalesce (p_provider, '')), ''));
  v_reference text := nullif (trim (coalesce (p_reference, '')), '');
  v_shop_org uuid;
  v_sub_id uuid;
  v_org uuid;
  v_cur_plan text;
  v_cur_cycle text;
  v_discount numeric;
  v_plan text;
  v_cycle text;
  v_campaign_id uuid;
  v_amount bigint;
  v_existing record;
  v_locked uuid;
  v_stale_id uuid;
begin
  select s.organization_id
    into v_shop_org
  from public.shops s
  where s.id = p_shop_id;

  if v_shop_org is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  if p_subscription_id is not null
     and not exists (
       select 1 from public.subscriptions s where s.id = p_subscription_id
     ) then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  select o_subscription_id, o_organization_id
    into v_sub_id, v_org
  from public._subscription_payment_resolve (p_shop_id, p_subscription_id);

  if v_sub_id is null then
    if p_subscription_id is not null
       or exists (
         select 1 from public.subscriptions s where s.organization_id = v_shop_org
       ) then
      return jsonb_build_object ('ok', false, 'error', 'shop_subscription_mismatch');
    end if;
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  if not public._subscription_payment_can_initiate (v_org) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if v_provider is null or v_provider !~ '^[a-z][a-z0-9_]{1,31}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_provider');
  end if;

  -- M3-G allowlist: the client may only name a server-registered provider.
  if not public.subscription_payment_provider_allowed (v_provider) then
    return jsonb_build_object ('ok', false, 'error', 'provider_not_allowed');
  end if;

  -- Resolve the requested (or current) plan / billing cycle. The SERVER picks
  -- the price from this; the client only ever asks for it.
  select sp.code,
         s.billing_interval,
         coalesce (s.admin_discount_percent, 0)
    into v_cur_plan, v_cur_cycle, v_discount
  from public.subscriptions s
  join public.subscription_plans sp on sp.id = s.plan_id
  where s.id = v_sub_id;

  if v_cur_plan is null then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  if p_plan_code is not null then
    v_plan := lower (nullif (trim (p_plan_code), ''));
    if v_plan is null
       or not exists (
         select 1 from public.subscription_plans sp where sp.code = v_plan and sp.is_active
       ) then
      return jsonb_build_object ('ok', false, 'error', 'plan_not_available');
    end if;
  else
    v_plan := v_cur_plan;
  end if;

  if p_billing_cycle is not null then
    v_cycle := case
      when lower (trim (p_billing_cycle)) in ('monthly', 'month') then 'month'
      when lower (trim (p_billing_cycle)) in ('yearly', 'annual', 'annually', 'year') then 'year'
      else null
    end;
    if v_cycle is null then
      return jsonb_build_object ('ok', false, 'error', 'invalid_billing_interval');
    end if;
  else
    v_cycle := v_cur_cycle;
  end if;

  -- Durable client id replay (same shape as migration 174).
  select sp.id, sp.subscription_id, sp.status, sp.amount_ugx
    into v_existing
  from public.subscription_payments sp
  where sp.id = v_payment_id;

  if found then
    if v_existing.subscription_id <> v_sub_id then
      return jsonb_build_object ('ok', false, 'error', 'payment_id_conflict');
    end if;
    return jsonb_build_object (
      'ok', true, 'idempotent', true,
      'payment_id', v_existing.id,
      'subscription_id', v_existing.subscription_id,
      'status', v_existing.status,
      'amount_ugx', v_existing.amount_ugx
    );
  end if;

  -- Provider reference replay: return the existing payment, never a second one.
  if v_reference is not null then
    select sp.id, sp.subscription_id, sp.status, sp.amount_ugx
      into v_existing
    from public.subscription_payments sp
    where sp.provider = v_provider
      and sp.reference = v_reference;

    if found then
      if v_existing.subscription_id <> v_sub_id then
        return jsonb_build_object ('ok', false, 'error', 'reference_subscription_mismatch');
      end if;
      return jsonb_build_object (
        'ok', true, 'idempotent', true,
        'payment_id', v_existing.id,
        'subscription_id', v_existing.subscription_id,
        'status', v_existing.status,
        'amount_ugx', v_existing.amount_ugx
      );
    end if;
  end if;

  -- Server price for the REQUESTED plan/cycle (shared core with the price
  -- page). M3-G: raises 'pricing_unavailable' for catalog plans when the
  -- canonical book cannot price them — never the legacy 066 fallback.
  v_amount := public.subscription_payment_plan_amount (v_plan, v_cycle, v_discount);

  if p_amount_ugx is not null and p_amount_ugx <> v_amount then
    return jsonb_build_object (
      'ok', false,
      'error', 'amount_mismatch',
      'expected_amount_ugx', v_amount
    );
  end if;

  -- Serialize concurrent intent creation for this subscription, then retire
  -- older pending checkouts so exactly one intent can remain actionable.
  select s.id
    into v_locked
  from public.subscriptions s
  where s.id = v_sub_id
  for update;

  if v_locked is null then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  for v_stale_id in
    select sp.id
      from public.subscription_payments sp
     where sp.subscription_id = v_sub_id
       and sp.status = 'pending'
       and sp.id <> v_payment_id
       and (v_reference is null or sp.reference is distinct from v_reference)
       -- M3-E: a payment already handed to the provider (initiated_at) must
       -- NEVER be stale-replaced.
       and nullif (sp.metadata ->> 'initiated_at', '') is null
       -- M3-G: a FRESH initiation claim (≤ 300 s) means a provider call is in
       -- flight right now — equally untouchable. An expired claim (crashed
       -- request) is replaceable again.
       and (
         nullif (sp.metadata ->> 'initiate_claimed_at', '') is null
         or (sp.metadata ->> 'initiate_claimed_at')::timestamptz
              < now () - interval '300 seconds'
       )
       for update
  loop
    update public.subscription_payments sp
       set status = 'cancelled',
           status_reason = 'stale_replaced'
     where sp.id = v_stale_id;

    perform public._internal_subscription_history_write (
      v_sub_id,
      'payment_cancelled',
      'Superseded by a newer payment intent',
      jsonb_build_object (
        'payment_id', v_stale_id,
        'status', 'cancelled',
        'status_reason', 'stale_replaced'
      )
    );
  end loop;

  begin
    insert into public.subscription_payments (
      id,
      subscription_id,
      organization_id,
      shop_id,
      amount_ugx,
      currency,
      provider,
      reference,
      status,
      recorded_by,
      note,
      metadata
    )
    values (
      v_payment_id,
      v_sub_id,
      v_org,
      p_shop_id,
      v_amount,
      'UGX',
      v_provider,
      v_reference,
      'pending',
      auth.uid (),
      nullif (trim (coalesce (p_note, '')), ''),
      jsonb_build_object (
        'created_via', 'subscription_payment_create',
        'checkout', jsonb_build_object (
          'plan_code', v_plan,
          'billing_interval', v_cycle,
          'quoted_amount', v_amount,
          'campaign_id', case
            when to_regclass ('public.subscription_canonical_prices') is not null
               and to_regclass ('public.pricing_campaign_plan_discounts') is not null
               and v_plan in ('starter', 'business', 'waka_plus')
            then public._pricing_active_campaign_id ()
            else null
          end,
          'quoted_at', now ()
        )
      )
    );
  exception
    when unique_violation then
      -- Lost the race on the durable id or the provider reference: return the
      -- winner instead of counting the payment twice.
      select sp.id, sp.subscription_id, sp.status, sp.amount_ugx
        into v_existing
      from public.subscription_payments sp
      where sp.id = v_payment_id
         or (v_reference is not null and sp.provider = v_provider and sp.reference = v_reference)
      limit 1;

      if not found then
        return jsonb_build_object ('ok', false, 'error', 'reference_conflict');
      end if;

      if v_existing.subscription_id <> v_sub_id then
        return jsonb_build_object ('ok', false, 'error', 'reference_subscription_mismatch');
      end if;

      return jsonb_build_object (
        'ok', true,
        'idempotent', true,
        'payment_id', v_existing.id,
        'subscription_id', v_existing.subscription_id,
        'status', v_existing.status,
        'amount_ugx', v_existing.amount_ugx
      );
  end;

  perform public._internal_subscription_history_write (
    v_sub_id,
    'payment_created',
    'Payment initiated',
    jsonb_build_object (
      'payment_id', v_payment_id,
      'subscription_id', v_sub_id,
      'shop_id', p_shop_id,
      'amount_ugx', v_amount,
      'provider', v_provider,
      'reference', v_reference,
      'status', 'pending',
      'plan_code', v_plan,
      'billing_interval', v_cycle
    )
  );

  perform public._subscription_payment_audit (
    v_sub_id,
    'subscription_payment_create',
    'Payment initiated',
    jsonb_build_object (
      'payment_id', v_payment_id,
      'amount_ugx', v_amount,
      'provider', v_provider,
      'reference', v_reference,
      'plan_code', v_plan,
      'billing_interval', v_cycle
    )
  );

  perform public._subscription_payment_refresh_status (v_sub_id);

  return jsonb_build_object (
    'ok', true,
    'idempotent', false,
    'payment_id', v_payment_id,
    'subscription_id', v_sub_id,
    'status', 'pending',
    'amount_ugx', v_amount,
    'expected_amount_ugx', v_amount,
    'plan_code', v_plan,
    'billing_interval', v_cycle
  );
end;
$$;
