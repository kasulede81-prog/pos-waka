-- Decision 028 — Public customer self-enrollment via shop enrollment links.
-- Additive after D027. Enrollment capability ≠ SEPARATE from public_card_token / qr_token.
-- Client never supplies authoritative shop_id. No points on enroll.

-- ---------- Rate-limit scopes ----------
do $rl$
declare
  v_con text;
begin
  select c.conname into v_con
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'edge_rate_limit_buckets'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%scope%';
  if v_con is not null then
    execute format('alter table public.edge_rate_limit_buckets drop constraint %I', v_con);
  end if;
end;
$rl$;

alter table public.edge_rate_limit_buckets
  add constraint edge_rate_limit_buckets_scope_check
  check (scope in ('card_read', 'wallet_issue', 'enroll_join', 'enroll_submit'));

create or replace function public.edge_rate_limit_consume (
  p_scope text,
  p_ip_hash text,
  p_token_hash text,
  p_ip_limit integer,
  p_ip_window_ms integer,
  p_token_limit integer,
  p_token_window_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_now_ms bigint;
  v_ip_window_start timestamptz;
  v_token_window_start timestamptz;
  v_ip_window_start_ms bigint;
  v_token_window_start_ms bigint;
  v_ip_hash text;
  v_token_hash text;
  v_ip_ok boolean := true;
  v_token_ok boolean := true;
  v_retry integer := 1;
  v_row_count integer;
begin
  if p_scope is null or p_scope not in ('card_read', 'wallet_issue', 'enroll_join', 'enroll_submit') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_scope');
  end if;

  perform public.edge_rate_limit_purge_expired (3_600_000);

  v_now_ms := (extract (epoch from clock_timestamp ()) * 1000)::bigint;

  v_ip_hash := nullif (btrim (coalesce (p_ip_hash, '')), '');
  v_token_hash := nullif (btrim (coalesce (p_token_hash, '')), '');

  if v_ip_hash is not null then
    if p_ip_limit is null or p_ip_limit < 1 or p_ip_window_ms is null or p_ip_window_ms < 1 then
      return jsonb_build_object ('ok', false, 'error', 'invalid_ip_limit');
    end if;
    perform pg_advisory_xact_lock (hashtextextended ('rl:' || p_scope || ':ip:' || v_ip_hash, 0));
    v_ip_window_start_ms := (v_now_ms / p_ip_window_ms) * p_ip_window_ms;
    v_ip_window_start := to_timestamp (v_ip_window_start_ms / 1000.0);
    v_row_count := null;

    insert into public.edge_rate_limit_buckets as b (
      scope, dim, key_hash, window_start, window_ms, count, updated_at
    )
    values (
      p_scope, 'ip', v_ip_hash, v_ip_window_start, p_ip_window_ms, 1, now ()
    )
    on conflict (scope, dim, key_hash, window_start) do update
      set count = b.count + 1,
          updated_at = now ()
      where b.count < p_ip_limit
    returning b.count into v_row_count;

    if v_row_count is null then
      v_ip_ok := false;
      v_retry := greatest (
        1,
        ceil (((v_ip_window_start_ms + p_ip_window_ms) - v_now_ms) / 1000.0)::integer
      );
    end if;
  end if;

  if not v_ip_ok then
    return jsonb_build_object (
      'ok', false,
      'error', 'rate_limited',
      'retry_after_seconds', v_retry
    );
  end if;

  if v_token_hash is not null then
    if p_token_limit is null or p_token_limit < 1 or p_token_window_ms is null or p_token_window_ms < 1 then
      if v_ip_hash is not null and v_ip_ok then
        update public.edge_rate_limit_buckets
        set count = greatest (0, count - 1),
            updated_at = now ()
        where scope = p_scope
          and dim = 'ip'
          and key_hash = v_ip_hash
          and window_start = v_ip_window_start;
      end if;
      return jsonb_build_object ('ok', false, 'error', 'invalid_token_limit');
    end if;
    perform pg_advisory_xact_lock (hashtextextended ('rl:' || p_scope || ':tok:' || v_token_hash, 0));
    v_token_window_start_ms := (v_now_ms / p_token_window_ms) * p_token_window_ms;
    v_token_window_start := to_timestamp (v_token_window_start_ms / 1000.0);
    v_row_count := null;

    insert into public.edge_rate_limit_buckets as b (
      scope, dim, key_hash, window_start, window_ms, count, updated_at
    )
    values (
      p_scope, 'token', v_token_hash, v_token_window_start, p_token_window_ms, 1, now ()
    )
    on conflict (scope, dim, key_hash, window_start) do update
      set count = b.count + 1,
          updated_at = now ()
      where b.count < p_token_limit
    returning b.count into v_row_count;

    if v_row_count is null then
      v_token_ok := false;
      v_retry := greatest (
        1,
        ceil (((v_token_window_start_ms + p_token_window_ms) - v_now_ms) / 1000.0)::integer
      );
      if v_ip_hash is not null and v_ip_ok then
        update public.edge_rate_limit_buckets
        set count = greatest (0, count - 1),
            updated_at = now ()
        where scope = p_scope
          and dim = 'ip'
          and key_hash = v_ip_hash
          and window_start = v_ip_window_start;
      end if;
    end if;
  end if;

  if not v_token_ok then
    return jsonb_build_object (
      'ok', false,
      'error', 'rate_limited',
      'retry_after_seconds', v_retry
    );
  end if;

  return jsonb_build_object ('ok', true);
end;
$fn$;

revoke all on function public.edge_rate_limit_consume (text, text, text, integer, integer, integer, integer) from public;
revoke all on function public.edge_rate_limit_consume (text, text, text, integer, integer, integer, integer) from anon;
revoke all on function public.edge_rate_limit_consume (text, text, text, integer, integer, integer, integer) from authenticated;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.edge_rate_limit_consume (text, text, text, integer, integer, integer, integer) to service_role;
  end if;
end;
$g$;

-- ---------- Enrollment links ----------
create table if not exists public.loyalty_enrollment_links (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  token text not null unique
    check (token ~ '^[a-f0-9]{64}$'),
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  label text null
    check (label is null or char_length(btrim(label)) between 1 and 80),
  created_at timestamptz not null default now (),
  created_by uuid null references auth.users (id),
  revoked_at timestamptz null,
  constraint loyalty_enrollment_links_revoke_shape check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

create unique index if not exists loyalty_enrollment_links_one_active_per_shop
  on public.loyalty_enrollment_links (shop_id)
  where status = 'active';

create index if not exists loyalty_enrollment_links_shop_idx
  on public.loyalty_enrollment_links (shop_id, status);

alter table public.loyalty_enrollment_links enable row level security;
alter table public.loyalty_enrollment_links force row level security;

revoke all on table public.loyalty_enrollment_links from public;
revoke all on table public.loyalty_enrollment_links from anon;
revoke all on table public.loyalty_enrollment_links from authenticated;

do $pol$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'loyalty_enrollment_links'
      and policyname = 'loyalty_enrollment_links_select_access'
  ) then
    create policy loyalty_enrollment_links_select_access
      on public.loyalty_enrollment_links
      for select to authenticated
      using (public.user_can_access_shop (shop_id));
  end if;
end;
$pol$;

do $gr$
begin
  grant select on table public.loyalty_enrollment_links to authenticated;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.loyalty_enrollment_links to service_role;
  end if;
end;
$gr$;

-- ---------- Merchant: get / create-regenerate / revoke ----------
create or replace function public.loyalty_get_enrollment_link (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_link public.loyalty_enrollment_links%rowtype;
  v_total integer;
  v_recent jsonb;
  v_has_link boolean := false;
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_link
  from public.loyalty_enrollment_links
  where shop_id = p_shop_id and status = 'active'
  order by created_at desc
  limit 1;
  v_has_link := found;

  select count(*)::int into v_total
  from public.loyalty_accounts a
  where a.shop_id = p_shop_id
    and coalesce(a.metadata -> 'enrollment' ->> 'source', '') = 'public_enrollment_link';

  select coalesce(jsonb_agg(row_to_json(x) order by x.enrolled_at desc), '[]'::jsonb)
  into v_recent
  from (
    select
      a.id as account_id,
      c.name as customer_name,
      a.enrolled_at
    from public.loyalty_accounts a
    join public.customers c on c.id = a.customer_id
    where a.shop_id = p_shop_id
      and coalesce(a.metadata -> 'enrollment' ->> 'source', '') = 'public_enrollment_link'
    order by a.enrolled_at desc
    limit 10
  ) x;

  if not v_has_link then
    return jsonb_build_object(
      'ok', true,
      'active', false,
      'registrations_total', v_total,
      'recent_registrations', coalesce(v_recent, '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'active', true,
    'link_id', v_link.id,
    'token', v_link.token,
    'status', v_link.status,
    'label', v_link.label,
    'created_at', v_link.created_at,
    'registrations_total', v_total,
    'recent_registrations', coalesce(v_recent, '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.loyalty_get_enrollment_link (uuid) from public;
grant execute on function public.loyalty_get_enrollment_link (uuid) to authenticated;

create or replace function public.loyalty_regenerate_enrollment_link (
  p_shop_id uuid,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_token text;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_id uuid;
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_label is not null and char_length(v_label) > 80 then
    return jsonb_build_object('ok', false, 'error', 'invalid_label');
  end if;

  update public.loyalty_enrollment_links
  set status = 'revoked',
      revoked_at = coalesce(revoked_at, now())
  where shop_id = p_shop_id
    and status = 'active';

  v_token := public.loyalty_generate_public_card_token();

  insert into public.loyalty_enrollment_links (shop_id, token, status, label, created_by)
  values (p_shop_id, v_token, 'active', v_label, auth.uid ())
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'link_id', v_id,
    'token', v_token,
    'status', 'active',
    'label', v_label,
    'created_at', now()
  );
end;
$fn$;

revoke all on function public.loyalty_regenerate_enrollment_link (uuid, text) from public;
grant execute on function public.loyalty_regenerate_enrollment_link (uuid, text) to authenticated;

create or replace function public.loyalty_revoke_enrollment_link (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_n integer;
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.loyalty_enrollment_links
  set status = 'revoked',
      revoked_at = coalesce(revoked_at, now())
  where shop_id = p_shop_id
    and status = 'active';
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'revoked', v_n);
end;
$fn$;

revoke all on function public.loyalty_revoke_enrollment_link (uuid) from public;
grant execute on function public.loyalty_revoke_enrollment_link (uuid) to authenticated;

-- ---------- Public preview (service_role only) ----------
create or replace function public.loyalty_preview_enrollment_link (p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_token text := lower(btrim(coalesce(p_token, '')));
  v_link public.loyalty_enrollment_links%rowtype;
  v_shop public.shops%rowtype;
  v_design public.loyalty_card_designs%rowtype;
  v_program public.loyalty_programs%rowtype;
begin
  if v_token is null or v_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'token_invalid');
  end if;

  select * into v_link
  from public.loyalty_enrollment_links
  where token = v_token;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_link.status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end if;

  select * into v_shop from public.shops where id = v_link.shop_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end if;

  select * into v_program from public.loyalty_programs where shop_id = v_link.shop_id;
  select * into v_design from public.loyalty_card_designs where shop_id = v_link.shop_id;

  return jsonb_build_object(
    'ok', true,
    'shop_name', coalesce(nullif(btrim(v_design.program_display_name), ''), v_shop.name),
    'welcome_message', coalesce(v_design.welcome_message, ''),
    'logo_url', coalesce(v_design.logo_url, ''),
    'primary_color', coalesce(v_design.primary_color, ''),
    'program_enabled', coalesce(v_program.enabled, false)
  );
end;
$fn$;

revoke all on function public.loyalty_preview_enrollment_link (text) from public;
revoke all on function public.loyalty_preview_enrollment_link (text) from anon;
revoke all on function public.loyalty_preview_enrollment_link (text) from authenticated;
do $pv$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.loyalty_preview_enrollment_link (text) to service_role;
  end if;
end;
$pv$;

-- ---------- Public enroll by token (service_role only) ----------
create or replace function public.loyalty_enroll_by_enrollment_token (
  p_token text,
  p_name text,
  p_phone_e164 text,
  p_email text default null,
  p_consent_accepted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_token text := lower(btrim(coalesce(p_token, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone_e164, ''));
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_link public.loyalty_enrollment_links%rowtype;
  v_customer public.customers%rowtype;
  v_account public.loyalty_accounts%rowtype;
  v_account_id uuid;
  v_customer_id uuid;
  v_new_customer boolean := false;
  v_new_account boolean := false;
  v_meta jsonb;
begin
  if v_token is null or v_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'token_invalid');
  end if;
  if not coalesce(p_consent_accepted, false) then
    return jsonb_build_object('ok', false, 'error', 'consent_required');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;
  if v_phone !~ '^\+256[0-9]{9}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_phone');
  end if;
  if v_email is not null and (
    char_length(v_email) > 254
    or v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  select * into v_link
  from public.loyalty_enrollment_links
  where token = v_token
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_link.status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end if;

  -- Prefer existing customer with loyalty account for this phone; else any matching phone.
  select c.* into v_customer
  from public.customers c
  where c.shop_id = v_link.shop_id
    and c.phone_e164 = v_phone
  order by exists (
    select 1 from public.loyalty_accounts a
    where a.customer_id = c.id and a.shop_id = v_link.shop_id
  ) desc,
  c.created_at desc
  limit 1;

  if found then
    v_customer_id := v_customer.id;
    select * into v_account
    from public.loyalty_accounts
    where shop_id = v_link.shop_id and customer_id = v_customer_id
    for update;

    if found then
      if v_account.status = 'revoked' then
        -- Do not reactivate; do not return card URL.
        return jsonb_build_object('ok', false, 'error', 'account_revoked');
      end if;
      -- active or suspended: already a member — no card URL (anti-enumeration / takeover).
      return jsonb_build_object('ok', false, 'error', 'already_member');
    end if;
  else
    insert into public.customers (shop_id, name, phone_e164, email)
    values (v_link.shop_id, v_name, v_phone, v_email)
    returning id into v_customer_id;
    v_new_customer := true;
  end if;

  -- Update name/email on existing customer only when creating membership for first time.
  if not v_new_customer then
    update public.customers
    set name = case when char_length(btrim(name)) < 2 then v_name else name end,
        email = coalesce(email, v_email),
        updated_at = now()
    where id = v_customer_id and shop_id = v_link.shop_id;
  end if;

  v_meta := jsonb_build_object(
    'consent', jsonb_build_object(
      'accepted', true,
      'accepted_at', now(),
      'accepted_by', null,
      'note', 'public_self_enrollment'
    ),
    'enrollment', jsonb_build_object(
      'source', 'public_enrollment_link',
      'link_id', v_link.id,
      'enrolled_at', now()
    )
  );

  insert into public.loyalty_accounts (shop_id, customer_id, enrolled_by, metadata, status)
  values (v_link.shop_id, v_customer_id, null, v_meta, 'active')
  on conflict (shop_id, customer_id) do nothing
  returning id into v_account_id;

  if v_account_id is not null then
    v_new_account := true;
    perform public.loyalty_stamp_new_account_membership(v_account_id, v_link.shop_id);
  else
    -- Race: account appeared; re-check status.
    select * into v_account
    from public.loyalty_accounts
    where shop_id = v_link.shop_id and customer_id = v_customer_id;
    if v_account.status = 'revoked' then
      return jsonb_build_object('ok', false, 'error', 'account_revoked');
    end if;
    return jsonb_build_object('ok', false, 'error', 'already_member');
  end if;

  select * into v_account from public.loyalty_accounts where id = v_account_id;

  -- Safety: never return points mutation path; balance must be 0 for brand-new account.
  if v_account.balance_points is distinct from 0 then
    raise exception 'public_enroll unexpected balance';
  end if;

  return jsonb_build_object(
    'ok', true,
    'new_customer', v_new_customer,
    'new_account', v_new_account,
    'public_card_token', v_account.public_card_token,
    'membership_active', public.loyalty_account_membership_active(
      v_account.status, v_account.membership_expires_at, now()
    ),
    'membership_expires_on', public.loyalty_membership_expires_on_date(v_account.membership_expires_at)
  );
end;
$fn$;

revoke all on function public.loyalty_enroll_by_enrollment_token (text, text, text, text, boolean) from public;
revoke all on function public.loyalty_enroll_by_enrollment_token (text, text, text, text, boolean) from anon;
revoke all on function public.loyalty_enroll_by_enrollment_token (text, text, text, text, boolean) from authenticated;
do $en$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.loyalty_enroll_by_enrollment_token (text, text, text, text, boolean) to service_role;
  end if;
end;
$en$;
