-- Waka POS — AI business setup finalize + admin reset RPCs (Phase 3)

create or replace function public.finalize_shop_ai_setup (
  p_shop_id uuid,
  p_skipped boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_shop_id is null then
    raise exception 'shop_id required';
  end if;

  if not exists (
    select 1 from public.shop_members sm
    where sm.shop_id = p_shop_id and sm.user_id = auth.uid ()
  ) and not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  update public.shops
  set ai_setup_completed_at = now ()
  where id = p_shop_id
    and ai_setup_completed_at is null;

  if p_skipped then
    delete from public.shop_ai_setup_templates where shop_id = p_shop_id;
  end if;

  return jsonb_build_object ('ok', true, 'skipped', coalesce (p_skipped, false));
end;
$$;

revoke all on function public.finalize_shop_ai_setup (uuid, boolean) from public;
grant execute on function public.finalize_shop_ai_setup (uuid, boolean) to authenticated;

create or replace function public.admin_reset_shop_ai_setup (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin', 'support_admin']) then
    raise exception 'Forbidden';
  end if;

  delete from public.shop_ai_setup_templates where shop_id = p_shop_id;

  update public.shops
  set ai_setup_completed_at = null
  where id = p_shop_id;

  insert into public.internal_ops_admin_audit (actor, action, payload)
  values (
    auth.uid (),
    'shop_ai_setup_reset',
    jsonb_build_object ('shop_id', p_shop_id)
  );

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.admin_reset_shop_ai_setup (uuid) from public;
grant execute on function public.admin_reset_shop_ai_setup (uuid) to authenticated;
