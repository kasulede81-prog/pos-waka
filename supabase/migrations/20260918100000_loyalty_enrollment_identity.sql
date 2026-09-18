-- Waka POS — Loyalty enrollment & identity (Phase 05)
--
-- Extends merchant-driven enrollment with explicit consent recording and
-- adds the opaque-token lookup used by QR identification. The customer
-- self-enrollment "scan a link" flow is intentionally merchant-mediated in
-- this phase: membership is created by a shop member (existing
-- `loyalty_enroll_customer` authorization), and the customer receives a
-- membership QR carrying ONLY the opaque `qr_token` — no personal data.

-- ---------- Enrollment with consent recording ----------
-- The Phase 02 migration created loyalty_enroll_customer(uuid, uuid). Adding
-- defaulted parameters creates an overload rather than replacing it, so drop
-- the old signature explicitly; the extended function keeps two-argument
-- calls working via parameter defaults.
drop function if exists public.loyalty_enroll_customer (uuid, uuid);

-- Backward compatible: the two-argument call from Phase 03 keeps working
-- (new parameters default). Consent is stored in account metadata; nothing
-- here credits points.
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

  if v_account_id is null then
    select * into v_account
    from public.loyalty_accounts
    where shop_id = p_shop_id and customer_id = p_customer_id;
  else
    select * into v_account from public.loyalty_accounts where id = v_account_id;
  end if;

  return jsonb_build_object('ok', true, 'account_id', v_account.id, 'qr_token', v_account.qr_token, 'already_enrolled', v_account_id is null);
end;
$function$;

grant execute on function public.loyalty_enroll_customer (uuid, uuid, boolean, text, jsonb) to authenticated;

-- ---------- QR identification (opaque token lookup) ----------
-- Resolves a scanned membership QR to the account + minimal customer data.
-- The token is unguessable (md5 of random + clock_timestamp) and carries no
-- personal information. Lookup requires shop access, so a token scanned at
-- the wrong shop simply resolves to nothing.
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
    'qr_token', v_account.qr_token
  );
end;
$function$;

grant execute on function public.loyalty_account_by_token (uuid, text) to authenticated;
