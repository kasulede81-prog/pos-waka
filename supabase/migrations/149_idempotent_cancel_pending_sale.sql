-- Phase SYNC-1.1-R2: cancel upload is idempotent when the sale is already cancelled.
-- Does not reopen cancelled sales. Draft cancel, missing, and unauthorized stay unchanged.

create or replace function public.shop_cancel_pending_sale (
  p_shop_id uuid,
  p_sale_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_status text;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select s.status
    into v_status
  from public.sales s
  where s.id = p_sale_id
    and s.shop_id = p_shop_id
  for update;

  if v_status is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found_or_not_draft');
  end if;

  if v_status = 'cancelled' then
    return jsonb_build_object (
      'ok', true,
      'sale_id', p_sale_id,
      'already_cancelled', true
    );
  end if;

  if v_status is distinct from 'draft' then
    return jsonb_build_object ('ok', false, 'error', 'not_found_or_not_draft');
  end if;

  update public.sales
  set
    status = 'cancelled',
    cancelled_at = now (),
    updated_at = now ()
  where id = p_sale_id
    and shop_id = p_shop_id
    and status = 'draft';

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'not_found_or_not_draft');
  end if;

  return jsonb_build_object (
    'ok', true,
    'sale_id', p_sale_id,
    'already_cancelled', false
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_cancel_pending_sale (uuid, uuid) from public;
grant execute on function public.shop_cancel_pending_sale (uuid, uuid) to authenticated;
