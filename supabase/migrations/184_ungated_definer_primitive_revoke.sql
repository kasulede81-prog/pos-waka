-- Revoke client EXECUTE on internal SECURITY DEFINER primitives missed by 183.
--
-- Finding 1 (P0): certified hard-delete execute + collect/report helpers are
-- DEFINER with no auth.uid() check. Wrappers stay the only client entry.
-- Finding 2 (P1): sale stock apply/reverse/return-stock primitives. Removes
-- the 083 GRANT EXECUTE … TO authenticated on apply_sale_stock_movements.
-- Finding 3 (P2): receipt counter / create_receipt_for_sale / shop_org_id.
--
-- Does not replace function bodies. Nested SECURITY DEFINER callers and
-- triggers keep working: they run as the function owner, so they do not need
-- anon/authenticated EXECUTE.
--
-- Idempotent: skips missing signatures. Safe to re-run. Does not GRANT
-- EXECUTE back to anon or authenticated.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Finding 1 — hard-delete internals. Do not revoke the gated wrappers:
--   owner_permanently_delete_own_account(text, text)
--   admin_permanently_delete_shop_account(uuid, text, text)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.certified_hard_delete_organization_execute(uuid,uuid,uuid,uuid,text,text)') is not null then
    execute 'revoke all on function public.certified_hard_delete_organization_execute (uuid, uuid, uuid, uuid, text, text) from public';
    execute 'revoke all on function public.certified_hard_delete_organization_execute (uuid, uuid, uuid, uuid, text, text) from anon';
    execute 'revoke all on function public.certified_hard_delete_organization_execute (uuid, uuid, uuid, uuid, text, text) from authenticated';
  end if;

  if to_regprocedure('public.hard_delete_collect_org_user_ids(uuid)') is not null then
    execute 'revoke all on function public.hard_delete_collect_org_user_ids (uuid) from public';
    execute 'revoke all on function public.hard_delete_collect_org_user_ids (uuid) from anon';
    execute 'revoke all on function public.hard_delete_collect_org_user_ids (uuid) from authenticated';
  end if;

  if to_regprocedure('public.hard_delete_collect_org_shop_ids(uuid)') is not null then
    execute 'revoke all on function public.hard_delete_collect_org_shop_ids (uuid) from public';
    execute 'revoke all on function public.hard_delete_collect_org_shop_ids (uuid) from anon';
    execute 'revoke all on function public.hard_delete_collect_org_shop_ids (uuid) from authenticated';
  end if;

  if to_regprocedure('public.hard_delete_verification_report(uuid,uuid[],uuid,uuid[])') is not null then
    execute 'revoke all on function public.hard_delete_verification_report (uuid, uuid[], uuid, uuid[]) from public';
    execute 'revoke all on function public.hard_delete_verification_report (uuid, uuid[], uuid, uuid[]) from anon';
    execute 'revoke all on function public.hard_delete_verification_report (uuid, uuid[], uuid, uuid[]) from authenticated';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Finding 2 — sale stock primitives (triggers / shop_push_* stay DEFINER).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.reverse_sale_stock_movements(uuid)') is not null then
    execute 'revoke all on function public.reverse_sale_stock_movements (uuid) from public';
    execute 'revoke all on function public.reverse_sale_stock_movements (uuid) from anon';
    execute 'revoke all on function public.reverse_sale_stock_movements (uuid) from authenticated';
  end if;

  if to_regprocedure('public.apply_sale_stock_movements(uuid)') is not null then
    execute 'revoke all on function public.apply_sale_stock_movements (uuid) from public';
    execute 'revoke all on function public.apply_sale_stock_movements (uuid) from anon';
    execute 'revoke all on function public.apply_sale_stock_movements (uuid) from authenticated';
  end if;

  if to_regprocedure('public.apply_sale_return_stock(uuid)') is not null then
    execute 'revoke all on function public.apply_sale_return_stock (uuid) from public';
    execute 'revoke all on function public.apply_sale_return_stock (uuid) from anon';
    execute 'revoke all on function public.apply_sale_return_stock (uuid) from authenticated';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Finding 3 — receipt / org-id helpers (DEFINER callers keep working).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.create_receipt_for_sale(uuid)') is not null then
    execute 'revoke all on function public.create_receipt_for_sale (uuid) from public';
    execute 'revoke all on function public.create_receipt_for_sale (uuid) from anon';
    execute 'revoke all on function public.create_receipt_for_sale (uuid) from authenticated';
  end if;

  if to_regprocedure('public.next_shop_counter(uuid,text)') is not null then
    execute 'revoke all on function public.next_shop_counter (uuid, text) from public';
    execute 'revoke all on function public.next_shop_counter (uuid, text) from anon';
    execute 'revoke all on function public.next_shop_counter (uuid, text) from authenticated';
  end if;

  if to_regprocedure('public.shop_org_id(uuid)') is not null then
    execute 'revoke all on function public.shop_org_id (uuid) from public';
    execute 'revoke all on function public.shop_org_id (uuid) from anon';
    execute 'revoke all on function public.shop_org_id (uuid) from authenticated';
  end if;
end
$$;
