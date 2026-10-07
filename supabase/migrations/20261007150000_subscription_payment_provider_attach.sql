-- ============================================================================
-- M3-C — PROVIDER REFERENCE ATTACH (payment-initiate ledger write)
-- ============================================================================
-- Provider-agnostic foundation only: NO MTN / NO Airtel / NO callback endpoints
-- (M3-F/M3-E respectively, pending PROVIDER DOCUMENTATION REQUIRED).
--
-- payment-initiate (Edge, service_role) needs to record, on an existing PENDING
-- payment, the outcome of a provider initiation:
--   - the provider's transaction reference (if the provider issued one)
--   - the customer phone used for the push payment (server-side only; M3-B's
--     read projection never returns raw metadata, so it cannot leak)
--   - initiated_at (the already-initiated marker that makes retries idempotent
--     and guarantees no second provider transaction is ever started)
--
-- Design constraints (per M3-C audit):
--   * NO tables, NO columns, NO schema change, NO state-machine change.
--   * SECURITY DEFINER + set search_path = public (project convention).
--   * Authority = _subscription_payment_can_settle (service_role | internal
--     billing roles) — exactly the settlement posture; a customer (even
--     owner/admin/billing) can never attach, so no client-side metadata write.
--   * Explicit scalar parameters only — no arbitrary jsonb parameter, so the
--     metadata projection stays tightly bounded to the keys below.
--   * Only a PENDING payment may be attached; terminal payments are refused
--     (payment_not_pending), preserving M1's state machine.
--   * Scoped to one payment id with the gate evaluated on THAT payment's
--     organization — cross-payment/cross-org attachment is impossible.
--   * amount / currency / plan / subscription / provider are never touched.
--   * Idempotent: a second attach with the same provider reference (or any
--     attach once initiated_at exists) returns idempotent:true without a
--     second write or a second history row.
--
-- M1 conventions preserved: history row via _internal_subscription_history_write
-- (no phone in the payload — PII stays in metadata only) + audit row via
-- _subscription_payment_audit.

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
    -- A different provider reference on an already-initiated payment is a bug
    -- or an attack: never silently overwrite the provider linkage.
    if v_ref is not null and v_existing_ref is not null and v_existing_ref <> v_ref then
      return jsonb_build_object ('ok', false, 'error', 'provider_reference_conflict');
    end if;
    -- Same reference (or none issued): idempotent success, NO second write,
    -- NO second history row — the first attach already wrote everything.
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

-- Settlement authority only: authenticated EXECUTE is retained for internal
-- staff (the can_settle gate denies customers inside the function); service_role
-- is the Edge caller. public/anon get nothing.
revoke all on function public.subscription_payment_provider_attach (uuid, text, text, timestamptz) from public;
revoke all on function public.subscription_payment_provider_attach (uuid, text, text, timestamptz) from anon;
grant execute on function public.subscription_payment_provider_attach (uuid, text, text, timestamptz) to authenticated;

do $service$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.subscription_payment_provider_attach (uuid, text, text, timestamptz) to service_role';
  end if;
end;
$service$;
