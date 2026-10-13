-- ============================================================================
-- PRINTER FULFILMENT — READ-ONLY ADDITIONS
-- ============================================================================
-- WHAT THIS ADDS, AND WHY IT IS A SEPARATE FILE.
-- `20261013100000_printer_inventory_and_fulfilment.sql` is already applied to
-- production, so it is not edited again. Everything here is additive:
--
--   1. `internal_ops_printer_handover_history` — the completed handovers, which
--      no RPC could list before. The console had to say "use the audit table",
--      which is not good enough for an operator reconciling hardware.
--   2. `internal_ops_printer_eligibility` — a READ-ONLY preview, so the console
--      can tell an operator an account does not qualify BEFORE they attempt a
--      reservation.
--   3. `internal_ops_printer_inventory` re-declared with display NAMES for the
--      account and branch, instead of making the screen resolve ids one search
--      at a time.
--
-- SECURITY POSTURE IS UNCHANGED. Both tables stay RLS-enabled with no policies
-- and all client privileges revoked; these functions are SECURITY DEFINER, gated
-- on `_printer_require_fulfilment_admin()` (super_admin | subscriptions_admin |
-- operations_admin — NOT finance_admin), granted only to `authenticated`, and
-- the gate is checked as the first statement of each.
--
-- NO BUSINESS RULE IS RE-IMPLEMENTED. Eligibility delegates to the existing
-- `_printer_promotion_eligible()` for the verdict. The reason string this file
-- returns is an EXPLANATION of a verdict already reached, never a second
-- decision — see the comment on the reason CASE.

-- ----------------------------------------------------------------------------
-- 1. Completed handovers
-- ----------------------------------------------------------------------------
/**
 * Every recorded handover, newest first.
 *
 * Reads the assignment row as the historical fact it is: the account and branch
 * SNAPSHOTS taken at handover are returned (not a live join), because an account
 * may since have been deleted and the record must still say who received the
 * printer. `organization_id` is NULL in exactly that case — the surviving row is
 * detached, by design.
 *
 * Contact details are returned because this RPC is gated on the fulfilment roles
 * and this is the record of a physical handover. It is not exposed to any shop
 * role: `my_org_printer_assignments()` remains the only customer-facing read and
 * it returns none of this.
 */
create or replace function public.internal_ops_printer_handover_history (
  p_limit int default 100,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least (greatest (coalesce (p_limit, 100), 1), 500);
  v_rows jsonb;
  v_total int;
begin
  perform public._printer_require_fulfilment_admin ();

  select count(*)::int into v_total
    from public.waka_printer_assignments a
   where a.status = 'handed_over'
     and (p_organization_id is null or a.organization_id = p_organization_id);

  select coalesce (jsonb_agg (row_json order by row_json ->> 'handed_over_at' desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object (
               'assignment_id', a.id,
               'unit_id', a.unit_id,
               'serial_number', u.serial_number,
               'model', u.model,
               'paper_width_mm', u.paper_width_mm,
               -- The account as it was named when the printer changed hands.
               'organization_id', a.organization_id,
               'organization_name', a.organization_name_snapshot,
               'account_deleted', a.organization_id is null,
               'shop_id', a.shop_id,
               'branch_name', a.shop_name_snapshot,
               'promotion_code', a.promotion_code,
               'fulfilment_method', a.fulfilment_method,
               'received_by_name', a.received_by_name,
               'received_by_phone', a.received_by_phone,
               'evidence_reference', a.evidence_reference,
               'note', a.reason,
               'handed_over_at', a.handed_over_at,
               'handed_over_by', a.handed_over_by,
               'subscription_id', a.subscription_id
             ) as row_json
        from public.waka_printer_assignments a
        join public.waka_printer_units u on u.id = a.unit_id
       where a.status = 'handed_over'
         and (p_organization_id is null or a.organization_id = p_organization_id)
       order by a.handed_over_at desc nulls last
       limit v_limit
    ) t;

  return jsonb_build_object (
    'ok', true,
    'handovers', v_rows,
    'returned', jsonb_array_length (v_rows),
    'total', v_total,
    'as_of', now ()
  );
end;
$$;

comment on function public.internal_ops_printer_handover_history (int, uuid) is
  'Completed printer handovers with the account and branch names recorded at '
  'handover. Fulfilment roles only. The historical record survives account '
  'deletion, so organization_id may be NULL while the snapshots remain.';

revoke all on function public.internal_ops_printer_handover_history (int, uuid) from public;
revoke all on function public.internal_ops_printer_handover_history (int, uuid) from anon;
grant execute on function public.internal_ops_printer_handover_history (int, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Eligibility preview — read-only, same rule as the reservation
-- ----------------------------------------------------------------------------
/**
 * Why an account does or does not qualify, WITHOUT reserving anything.
 *
 * THE VERDICT COMES FROM `_printer_promotion_eligible()` — the same function
 * `internal_ops_printer_assign` calls. This file does not restate the rule and
 * cannot drift from it: if the predicate changes, `eligible` changes with it.
 *
 * The `reason` is an EXPLANATION of that verdict, computed from the component
 * facts purely so an operator can be told which part failed. It is deliberately
 * NOT authoritative — a disagreement between `eligible` and `reason` resolves in
 * favour of `eligible`, and the UI is written that way.
 *
 * Returns the facts too (plan, interval, status, period end) so the screen can
 * show what the server actually sees rather than paraphrase it.
 */
create or replace function public.internal_ops_printer_eligibility (
  p_shop_id uuid,
  p_promotion_code text default 'business_annual_printer_v1'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_shop_status text;
  v_shop_name text;
  v_sub_id uuid;
  v_plan text;
  v_status text;
  v_interval text;
  v_period_end timestamptz;
  v_eligible boolean := false;
  v_promo text := coalesce (nullif (trim (p_promotion_code), ''), 'business_annual_printer_v1');
  v_open_claim jsonb;
  v_reason text;
begin
  perform public._printer_require_fulfilment_admin ();

  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  select s.organization_id, s.branch_status, s.name
    into v_org, v_shop_status, v_shop_name
    from public.shops s where s.id = p_shop_id;

  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  -- The shared resolver, the same call the money paths make.
  v_sub_id := public._subscription_latest_for_org (v_org);

  if v_sub_id is not null then
    select sp.code, s.status, s.billing_interval, s.current_period_end
      into v_plan, v_status, v_interval, v_period_end
      from public.subscriptions s
      join public.subscription_plans sp on sp.id = s.plan_id
     where s.id = v_sub_id;

    v_eligible := public._printer_promotion_eligible (v_sub_id);
  end if;

  -- An existing open claim is reported separately from eligibility: an account
  -- can be perfectly eligible and still already have its one printer.
  select jsonb_build_object (
           'assignment_id', a.id,
           'status', a.status,
           'serial_number', u.serial_number,
           'reserved_until', a.reserved_until
         )
    into v_open_claim
    from public.waka_printer_assignments a
    join public.waka_printer_units u on u.id = a.unit_id
   where a.organization_id = v_org
     and a.promotion_code = v_promo
     and a.status in ('reserved', 'ready_for_collection', 'handed_over')
   order by a.created_at desc
   limit 1;

  -- EXPLANATION ONLY. Ordered the way an operator would reason, and deliberately
  -- silent when `eligible` is true.
  if not v_eligible then
    if v_shop_status <> 'active' then
      v_reason := 'shop_not_active';
    elsif v_sub_id is null then
      v_reason := 'no_subscription';
    elsif v_status <> 'active' then
      v_reason := 'subscription_not_active';
    elsif lower (coalesce (v_interval, '')) <> 'year' then
      v_reason := 'not_annual';
    elsif lower (coalesce (v_plan, '')) <> 'business' then
      v_reason := 'not_business';
    elsif v_period_end is null or v_period_end <= now () then
      v_reason := 'period_ended';
    else
      -- The predicate refused and none of the components explains why. Say so
      -- rather than inventing a cause.
      v_reason := 'not_eligible';
    end if;
  end if;

  return jsonb_build_object (
    'ok', true,
    'shop_id', p_shop_id,
    'shop_name', v_shop_name,
    'shop_active', v_shop_status = 'active',
    'organization_id', v_org,
    'subscription_id', v_sub_id,
    'plan_code', v_plan,
    'subscription_status', v_status,
    'billing_interval', v_interval,
    'current_period_end', v_period_end,
    'promotion_code', v_promo,
    -- THE VERDICT. Authoritative.
    'eligible', v_eligible,
    -- Why, for the operator. Explanatory, never the decision.
    'reason', v_reason,
    'open_claim', v_open_claim,
    'can_reserve', v_eligible and v_open_claim is null,
    'reservation_days', 14,
    'checked_at', now ()
  );
end;
$$;

comment on function public.internal_ops_printer_eligibility (uuid, text) is
  'Read-only eligibility preview for a shop''s account. The verdict is delegated '
  'to _printer_promotion_eligible(); `reason` only explains it. Reserves nothing.';

revoke all on function public.internal_ops_printer_eligibility (uuid, text) from public;
revoke all on function public.internal_ops_printer_eligibility (uuid, text) from anon;
grant execute on function public.internal_ops_printer_eligibility (uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Inventory, now with display names
-- ----------------------------------------------------------------------------
-- Re-declared from `20261013100000` with names added and NOTHING else changed:
-- same signature, same gate, same sweep, same payload keys plus new ones. The
-- signature is identical, so `create or replace` preserves the existing ACL.
--
-- The joins are left joins on the ids already returned, so this costs no extra
-- round trip and cannot drop a row whose account or branch has since been
-- deleted — it simply reports a null name, exactly as the record does.
create or replace function public.internal_ops_printer_inventory (
  p_status text default null,
  p_limit int default 200
)
returns jsonb
language plpgsql
-- VOLATILE for the same reason as my_org_printer_assignments: the console's
-- view of the pool reclaims expired reservations first, so a "reserved" row it
-- shows is one that is genuinely still held.
security definer
set search_path = public
as $$
declare
  v_status text := nullif (lower (trim (coalesce (p_status, ''))), '');
  v_limit int := least (greatest (coalesce (p_limit, 200), 1), 1000);
  v_counts jsonb;
  v_units jsonb;
  v_assignments jsonb;
begin
  perform public._printer_require_fulfilment_admin ();

  if v_status is not null
     and v_status not in ('available', 'reserved', 'assigned', 'damaged', 'retired') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_status');
  end if;

  -- Reclaim before reading, so the counts and the open list the console acts on
  -- reflect reality rather than a lease that lapsed yesterday.
  perform public._printer_reclaim_expired_reservations ();

  select jsonb_object_agg (t.status, t.n)
    into v_counts
    from (
      select u.status, count(*)::int as n
        from public.waka_printer_units u
       group by u.status
    ) t;

  select coalesce (jsonb_agg (
           jsonb_build_object (
             'unit_id', u.id, 'serial_number', u.serial_number, 'model', u.model,
             'paper_width_mm', u.paper_width_mm, 'batch_code', u.batch_code,
             'condition', u.condition, 'status', u.status,
             'held_at_shop_id', u.held_at_shop_id,
             'held_at_shop_name', sh.name,
             'notes', u.notes,
             'created_at', u.created_at, 'updated_at', u.updated_at
           )
           order by u.serial_number
         ), '[]'::jsonb)
    into v_units
    from (
      select * from public.waka_printer_units u2
       where v_status is null or u2.status = v_status
       order by u2.serial_number
       limit v_limit
    ) u
    left join public.shops sh on sh.id = u.held_at_shop_id;

  select coalesce (jsonb_agg (
           jsonb_build_object (
             'assignment_id', a.id, 'status', a.status,
             'unit_id', a.unit_id, 'serial_number', u.serial_number,
             'organization_id', a.organization_id, 'organization_name', o.name,
             'shop_id', a.shop_id, 'shop_name', sh.name,
             'promotion_code', a.promotion_code, 'reserved_until', a.reserved_until,
             'created_at', a.created_at
           )
           order by a.created_at
         ), '[]'::jsonb)
    into v_assignments
    from public.waka_printer_assignments a
    join public.waka_printer_units u on u.id = a.unit_id
    left join public.organizations o on o.id = a.organization_id
    left join public.shops sh on sh.id = a.shop_id
   where a.status in ('reserved', 'ready_for_collection');

  return jsonb_build_object (
    'ok', true,
    'counts', coalesce (v_counts, '{}'::jsonb),
    'units', v_units,
    'open_assignments', v_assignments,
    'as_of', now ()
  );
end;
$$;

notify pgrst, 'reload schema';
