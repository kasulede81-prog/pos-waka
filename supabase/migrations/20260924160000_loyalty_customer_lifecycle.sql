-- Decision 027 — Per-account membership expiry admin + lifecycle (suspend/revoke) + 30-day purge.
-- Additive on D026. Does NOT rewrite C1/C2/C3/D026 migration files.
-- Does NOT mutate historical ledger rows on suspend/revoke.
-- Purge deletes ONLY the loyalty_accounts row (CASCADE to loyalty-specific dependents).
-- Does NOT delete customers / sales / payments / inventory.

-- ---------- Schema: status + retention ----------
do $status$
declare
  v_con text;
begin
  select c.conname into v_con
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'loyalty_accounts'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%status%';
  if v_con is not null then
    execute format('alter table public.loyalty_accounts drop constraint %I', v_con);
  end if;
end;
$status$;

update public.loyalty_accounts
set status = 'suspended'
where status = 'disabled';

alter table public.loyalty_accounts
  add column if not exists revoked_at timestamptz null,
  add column if not exists purge_after timestamptz null;

alter table public.loyalty_accounts
  add constraint loyalty_accounts_status_check
  check (status in ('active', 'suspended', 'revoked'));

do $ret$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'loyalty_accounts_revocation_shape'
  ) then
    alter table public.loyalty_accounts
      add constraint loyalty_accounts_revocation_shape
      check (
        (status = 'revoked' and revoked_at is not null and purge_after is not null)
        or (status <> 'revoked' and revoked_at is null and purge_after is null)
      );
  end if;
end;
$ret$;

create index if not exists loyalty_accounts_purge_after_idx
  on public.loyalty_accounts (purge_after)
  where status = 'revoked';

-- ---------- Empty offer resolution (lifecycle gate) ----------
create or replace function public.loyalty_empty_offer_resolution (
  p_resolved_at timestamptz default now()
)
returns jsonb
language sql
immutable
set search_path = public
as $fn$
  select jsonb_build_object(
    'ok', true,
    'effective_multiplier', 1,
    'multiplier_offer_id', null,
    'flat_bonus_points', 0,
    'flat_bonus_parts', '[]'::jsonb,
    'reward_grant_ids', '[]'::jsonb,
    'status_badges', '[]'::jsonb,
    'applicable_offers', '[]'::jsonb,
    'resolved_at', coalesce(p_resolved_at, now())
  );
$fn$;

-- ---------- Resolve: no offers when account not ACTIVE ----------
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

  -- Suspended / revoked (and any non-active) → offers do not apply.
  if v_account.status is distinct from 'active' then
    return public.loyalty_empty_offer_resolution(v_now);
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

-- ---------- Lifecycle admin ----------
create or replace function public.loyalty_set_account_lifecycle (
  p_shop_id uuid,
  p_account_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_account public.loyalty_accounts%rowtype;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_token text;
  v_balance integer;
  v_revoked_at timestamptz;
  v_purge timestamptz;
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_action not in ('suspend', 'reactivate', 'revoke') then
    return jsonb_build_object('ok', false, 'error', 'invalid_action');
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

  if v_action = 'suspend' then
    if v_account.status = 'revoked' then
      return jsonb_build_object('ok', false, 'error', 'account_revoked');
    end if;
    if v_account.status = 'suspended' then
      return jsonb_build_object(
        'ok', true,
        'account_id', v_account.id,
        'status', 'suspended',
        'already', true
      );
    end if;
    update public.loyalty_accounts
    set status = 'suspended',
        updated_at = now()
    where id = v_account.id and shop_id = p_shop_id;

  elsif v_action = 'reactivate' then
    if v_account.status = 'revoked' then
      return jsonb_build_object('ok', false, 'error', 'account_revoked');
    end if;
    if v_account.status = 'active' then
      return jsonb_build_object(
        'ok', true,
        'account_id', v_account.id,
        'status', 'active',
        'already', true
      );
    end if;
    if v_account.status <> 'suspended' then
      return jsonb_build_object('ok', false, 'error', 'invalid_status');
    end if;
    update public.loyalty_accounts
    set status = 'active',
        updated_at = now()
    where id = v_account.id and shop_id = p_shop_id;

  else -- revoke
    if v_account.status = 'revoked' then
      return jsonb_build_object(
        'ok', true,
        'account_id', v_account.id,
        'status', 'revoked',
        'revoked_at', v_account.revoked_at,
        'purge_after', v_account.purge_after,
        'already', true
      );
    end if;
    v_revoked_at := now();
    v_purge := v_revoked_at + interval '30 days';
    update public.loyalty_accounts
    set status = 'revoked',
        revoked_at = v_revoked_at,
        purge_after = v_purge,
        updated_at = now()
    where id = v_account.id and shop_id = p_shop_id;
  end if;

  select * into v_account from public.loyalty_accounts where id = p_account_id;

  if v_account.public_card_token is distinct from v_token
     or v_account.balance_points is distinct from v_balance then
    raise exception 'loyalty_set_account_lifecycle mutated token or balance';
  end if;

  return jsonb_build_object(
    'ok', true,
    'account_id', v_account.id,
    'status', v_account.status,
    'revoked_at', v_account.revoked_at,
    'purge_after', v_account.purge_after,
    'membership_expires_at', v_account.membership_expires_at,
    'membership_expires_on', public.loyalty_membership_expires_on_date(v_account.membership_expires_at),
    'membership_active', public.loyalty_account_membership_active(
      v_account.status, v_account.membership_expires_at, now()
    ),
    'balance_points', v_account.balance_points
  );
end;
$fn$;

revoke all on function public.loyalty_set_account_lifecycle (uuid, uuid, text) from public;
revoke all on function public.loyalty_set_account_lifecycle (uuid, uuid, text) from anon;
grant execute on function public.loyalty_set_account_lifecycle (uuid, uuid, text) to authenticated;

-- ---------- Renew / individual expiry: block revoked ----------
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
  if v_account.status = 'revoked' then
    return jsonb_build_object('ok', false, 'error', 'account_revoked');
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
  set membership_expires_at = v_expires,
      updated_at = now()
  where id = v_account.id
    and shop_id = p_shop_id;

  select * into v_account from public.loyalty_accounts where id = p_account_id;

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
    'balance_points', v_account.balance_points,
    'status', v_account.status
  );
end;
$function$;

-- ---------- Search: expose lifecycle fields ----------
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
          a.revoked_at,
          a.purge_after,
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

-- ---------- Enroll: refuse to treat revoked as usable ----------
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
      v_account.status, v_account.membership_expires_at, now()
    )
  );
end;
$function$;

-- ---------- Award: lifecycle reasons (sale still completes) ----------
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

-- ---------- Redeem: lifecycle errors ----------
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
  if v_account.status = 'revoked' then
    return jsonb_build_object ('ok', false, 'error', 'account_revoked');
  end if;
  if v_account.status = 'suspended' then
    return jsonb_build_object ('ok', false, 'error', 'account_suspended');
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

-- ---------- Purge: only revoked past purge_after ----------
create or replace function public.loyalty_purge_revoked_accounts (
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_ids uuid[];
  v_deleted integer := 0;
  v_customer_ids uuid[];
  v_sales_before bigint;
  v_sales_after bigint;
begin
  with due as (
    select id
    from public.loyalty_accounts
    where status = 'revoked'
      and purge_after is not null
      and purge_after <= now()
    order by purge_after asc, id asc
    limit v_limit
    for update skip locked
  )
  select coalesce(array_agg(due.id), '{}'::uuid[])
  into v_ids
  from due;

  if coalesce(cardinality(v_ids), 0) = 0 then
    return jsonb_build_object('ok', true, 'deleted', 0);
  end if;

  select coalesce(array_agg(distinct customer_id), '{}'::uuid[])
  into v_customer_ids
  from public.loyalty_accounts
  where id = any (v_ids);

  select count(*) into v_sales_before
  from public.sales
  where customer_id = any (v_customer_ids);

  -- CASCADE removes: transactions, redemptions, lot allocations, offers, wallet outbox.
  delete from public.loyalty_accounts
  where id = any (v_ids)
    and status = 'revoked'
    and purge_after is not null
    and purge_after <= now();

  get diagnostics v_deleted = row_count;

  select count(*) into v_sales_after
  from public.sales
  where customer_id = any (v_customer_ids);

  if v_sales_after is distinct from v_sales_before then
    raise exception 'loyalty_purge mutated sales';
  end if;

  -- Customers must remain.
  if exists (
    select 1
    from unnest(v_customer_ids) c(id)
    where not exists (select 1 from public.customers cu where cu.id = c.id)
  ) then
    raise exception 'loyalty_purge deleted customers';
  end if;

  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end;
$fn$;

revoke all on function public.loyalty_purge_revoked_accounts (integer) from public;
revoke all on function public.loyalty_purge_revoked_accounts (integer) from anon;
revoke all on function public.loyalty_purge_revoked_accounts (integer) from authenticated;

-- Daily purge via pg_cron when available (same pattern as rate-limit purge).
do $cron$
begin
  if to_regnamespace('cron') is null then
    begin
      create extension if not exists pg_cron with schema pg_catalog;
    exception when others then
      raise notice 'pg_cron unavailable; schedule loyalty purge manually';
      return;
    end;
  end if;
  if to_regnamespace('cron') is null then
    return;
  end if;
  begin
    perform cron.unschedule('waka-loyalty-purge-revoked');
  exception when others then
    null;
  end;
  begin
    perform cron.schedule(
      'waka-loyalty-purge-revoked',
      '27 3 * * *',
      $job$select public.loyalty_purge_revoked_accounts(500);$job$
    );
  exception when others then
    raise notice 'could not schedule waka-loyalty-purge-revoked: %', sqlerrm;
  end;
end;
$cron$;
