-- Reuse Waka shop numbers (A001, …) when a shop is permanently deleted.

create table if not exists public.waka_shop_number_released (
  shop_number text primary key,
  released_at timestamptz not null default now()
);

comment on table public.waka_shop_number_released is
  'Shop numbers freed by permanent delete; reassigned to the next new shop before incrementing the counter.';

create or replace function public.next_waka_shop_number ()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released text;
  v_seq int;
begin
  select r.shop_number into v_released
  from public.waka_shop_number_released r
  order by (substring (upper (trim (r.shop_number)) from 2))::int asc nulls last
  limit 1
  for update of r;

  if v_released is not null then
    delete from public.waka_shop_number_released r
    where r.shop_number = v_released;
    return upper (trim (v_released));
  end if;

  update public.waka_shop_number_counter
  set next_seq = next_seq + 1
  where id = 1
  returning next_seq - 1 into v_seq;

  if v_seq is null then
    insert into public.waka_shop_number_counter (id, next_seq)
    values (1, 2)
    on conflict (id) do update
    set next_seq = public.waka_shop_number_counter.next_seq + 1
    returning next_seq -  1 into v_seq;
  end if;

  return public.format_waka_shop_number (v_seq);
end;
$$;

-- Release numbers before org cascade deletes shop rows.
create or replace function public.admin_permanently_delete_shop_account (
  p_shop_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_owner_id uuid;
  v_shop_name text;
  v_owner_email text;
  v_agents_removed int := 0;
  v_referrals_removed int := 0;
  v_sales_deleted int := 0;
  v_numbers_released int := 0;
  v_confirm text := upper (trim (coalesce (p_confirmation, '')));
begin
  if not public.is_waka_internal_role (array['super_admin']::text[]) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden', 'detail', 'Super admin only.');
  end if;

  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_id_required');
  end if;

  select sh.organization_id, sh.name
  into v_org_id, v_shop_name
  from public.shops sh
  where sh.id = p_shop_id;

  if v_org_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  if v_confirm <> 'DELETE PERMANENTLY' and v_confirm <> upper (trim (v_shop_name)) then
    return jsonb_build_object (
      'ok',
      false,
      'error',
      'confirmation_required',
      'detail',
      'Type DELETE PERMANENTLY or the exact shop name to confirm.'
    );
  end if;

  select sm.user_id
  into v_owner_id
  from public.shop_members sm
  where sm.shop_id = p_shop_id
    and sm.role = 'owner'
  order by sm.created_at asc
  limit 1;

  if v_owner_id is null then
    select sm.user_id
    into v_owner_id
    from public.shop_members sm
    where sm.shop_id = p_shop_id
    order by sm.created_at asc
    limit 1;
  end if;

  if v_owner_id is null then
    return jsonb_build_object ('ok', false, 'error', 'owner_not_found');
  end if;

  if v_owner_id = auth.uid () then
    return jsonb_build_object ('ok', false, 'error', 'cannot_delete_self');
  end if;

  if exists (
    select 1
    from public.internal_admins ia
    where (ia.auth_user_id = v_owner_id or ia.user_id = v_owner_id)
      and coalesce (ia.is_active, ia.active, true) = true
  ) then
    return jsonb_build_object ('ok', false, 'error', 'cannot_delete_internal_admin');
  end if;

  select lower (trim (coalesce (pr.email, u.email, '')))
  into v_owner_email
  from auth.users u
  left join public.profiles pr on pr.id = u.id
  where u.id = v_owner_id;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'internal',
    'admin_permanent_delete_shop_started',
    'Permanent delete shop account started',
    jsonb_build_object (
      'shop_id',
      p_shop_id,
      'organization_id',
      v_org_id,
      'owner_user_id',
      v_owner_id,
      'shop_name',
      v_shop_name
    )
  );

  insert into public.waka_shop_number_released (shop_number)
  select distinct upper (trim (sh.shop_number))
  from public.shops sh
  where sh.organization_id = v_org_id
    and sh.shop_number is not null
    and trim (sh.shop_number) <> ''
    and upper (trim (sh.shop_number)) ~ '^A[0-9]+$'
  on conflict (shop_number) do nothing;
  get diagnostics v_numbers_released = row_count;

  delete from public.agent_referrals ar
  where ar.referred_user_id = v_owner_id
     or ar.referred_shop_id = p_shop_id
     or ar.organization_id = v_org_id;
  get diagnostics v_referrals_removed = row_count;

  delete from public.marketing_agents ma
  where ma.user_id = v_owner_id
     or (
       v_owner_email is not null
       and v_owner_email <> ''
       and ma.email is not null
       and lower (trim (ma.email)) = v_owner_email
     );
  get diagnostics v_agents_removed = row_count;

  delete from public.profiles pr
  where pr.id = v_owner_id;

  delete from public.sales s
  where s.shop_id in (
    select sh.id from public.shops sh where sh.organization_id = v_org_id
  );
  get diagnostics v_sales_deleted = row_count;

  delete from public.organizations o
  where o.id = v_org_id;

  return jsonb_build_object (
    'ok',
    true,
    'owner_user_id',
    v_owner_id,
    'organization_id',
    v_org_id,
    'shop_name',
    v_shop_name,
    'sales_deleted',
    v_sales_deleted,
    'agents_removed',
    v_agents_removed,
    'referrals_removed',
    v_referrals_removed,
    'shop_numbers_released',
    v_numbers_released
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'delete_failed', 'detail', sqlerrm);
end;
$$;
