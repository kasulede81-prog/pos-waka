-- Allow idempotent owner membership writes (INSERT … ON CONFLICT) when the same
-- user is already shop owner. The previous trigger rejected any INSERT with role
-- owner if *any* owner row existed, before ON CONFLICT could upgrade to UPDATE.
-- That broke save_owner_business_profile_bundle after bootstrap_owner_workspace.

create or replace function public.trg_shop_members_enforce_single_owner ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  if new.role is distinct from 'owner' then
    return new;
  end if;

  select sm.user_id
  into v_existing
  from public.shop_members sm
  where sm.shop_id = new.shop_id
    and sm.role = 'owner'
    and sm.user_id is distinct from new.user_id
  limit 1;

  if v_existing is not null then
    insert into public.audit_logs (
      shop_id,
      actor_user_id,
      role,
      action,
      payload_summary,
      payload
    )
    values (
      new.shop_id,
      auth.uid (),
      'owner',
      'auth_forbidden',
      'Rejected second shop owner assignment',
      jsonb_build_object (
        'attempted_user_id', new.user_id,
        'existing_owner_user_id', v_existing
      )
    );
    raise exception 'shop_already_has_owner'
      using hint = 'This shop already has an owner.';
  end if;

  return new;
end;
$$;
