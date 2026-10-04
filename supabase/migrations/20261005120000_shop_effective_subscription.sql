-- ============================================================================
-- Phase 10 — read a shop's subscription from the SHOP, not from the caller
-- ============================================================================
-- THE DEFECT THIS CLOSES. A cashier of a shop on a paid plan saw "Free plan".
--
-- The client resolved the plan through `subscriptions`, whose SELECT policy is
--
--   user_has_org_role(organization_id, ARRAY['owner','admin','billing','staff'])
--
-- and `user_has_org_role()` reads `organization_members`. An invited cashier is a
-- STAFF member of a shop (`shop_members` + `shop_pos_staff`) and holds no
-- organization row for the invited shop's organization — so the policy refused the
-- read, the query returned zero rows, and the client could not tell "this shop has
-- no subscription" apart from "you are not allowed to see it". It fell back to
-- `free`, and a paying shop's terminal showed Free.
--
-- THE FIX IS THE READ PATH, NOT THE POLICY. This function answers the same question
-- through the SHOP the caller is actually operating in:
--
--   auth.uid() → user_can_access_shop(shop) → shop.organization_id → subscription
--
-- The organization is derived SERVER-SIDE from the shop id; a client-supplied
-- organization id is neither accepted nor trusted. `user_can_access_shop()` is the
-- existing authoritative predicate already behind the `shops`, `shop_members` and
-- `shop_pos_staff` policies, so this grants nothing that shop access did not already
-- imply — it only lets a staff member READ the plan of the shop they may operate.
--
-- NOT CHANGED HERE, DELIBERATELY:
--   * `subscriptions_select` is untouched. Cashiers gain no direct table access.
--   * No `organization_members` row is created for staff — that table is the
--     ownership/admin authority and also guards `subscriptions_update`.
--   * Nothing is written: no subscription, shop, organization or membership row.
--   * Mutation permissions are untouched; this function is read-only.

-- ----------------------------------------------------------------------------
-- Shop-scoped subscription read
-- ----------------------------------------------------------------------------
create or replace function public.shop_get_effective_subscription (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid ();
  v_org uuid;
  v_row record;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'unauthenticated');
  end if;

  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_required');
  end if;

  -- The existing authoritative gate. A caller who cannot access this shop learns
  -- nothing — not even whether it exists.
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  -- Organization derived from the SHOP, never from the caller.
  select sh.organization_id into v_org
  from public.shops sh
  where sh.id = p_shop_id;

  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  -- Same selection rule the client used before: latest subscription for the org.
  select
    s.id,
    s.organization_id,
    s.shop_id,
    s.status,
    s.trial_ends_at,
    s.current_period_start,
    s.current_period_end,
    sp.code as plan_code,
    sp.max_pos_users,
    sp.max_shops,
    sp.features
  into v_row
  from public.subscriptions s
  join public.subscription_plans sp on sp.id = s.plan_id
  where s.organization_id = v_org
  order by s.created_at desc
  limit 1;

  -- `found: false` is a REAL answer: the caller may access this shop and the shop
  -- genuinely has no subscription. That is what legitimately reads as Free. A
  -- refusal above is `ok: false` instead, so the two can never be conflated again.
  if v_row.id is null then
    return jsonb_build_object ('ok', true, 'found', false);
  end if;

  return jsonb_build_object (
    'ok', true,
    'found', true,
    'subscription', jsonb_build_object (
      'id', v_row.id,
      'organization_id', v_row.organization_id,
      'shop_id', v_row.shop_id,
      'status', v_row.status,
      'trial_ends_at', v_row.trial_ends_at,
      'current_period_start', v_row.current_period_start,
      'current_period_end', v_row.current_period_end,
      'plan_code', v_row.plan_code,
      'max_pos_users', v_row.max_pos_users,
      'max_shops', v_row.max_shops,
      'features', coalesce (v_row.features, '{}'::jsonb)
    )
  );
end;
$$;

-- Authenticated only. An anonymous caller has no shop to access and no reason to ask.
revoke all on function public.shop_get_effective_subscription (uuid) from public;
revoke all on function public.shop_get_effective_subscription (uuid) from anon;
grant execute on function public.shop_get_effective_subscription (uuid) to authenticated;
