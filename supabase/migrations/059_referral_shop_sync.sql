-- Backfill referred shop/org on agent_referrals after workspace bootstrap.

create or replace function public.sync_agent_referral_shop_context ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_shop_id uuid;
  v_org_id uuid;
  v_shop_name text;
  v_email text;
  v_updated int := 0;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select sm.shop_id, s.organization_id, s.name
  into v_shop_id, v_org_id, v_shop_name
  from public.shop_members sm
  join public.shops s on s.id = sm.shop_id
  where sm.user_id = v_uid
  order by sm.created_at asc
  limit 1;

  select u.email into v_email from auth.users u where u.id = v_uid;

  update public.agent_referrals ar
  set
    referred_shop_id = coalesce (v_shop_id, ar.referred_shop_id),
    organization_id = coalesce (v_org_id, ar.organization_id),
    shop_name = coalesce (nullif (trim (v_shop_name), ''), ar.shop_name),
    owner_email = coalesce (nullif (trim (v_email), ''), ar.owner_email)
  where ar.referred_user_id = v_uid
    and (
      ar.referred_shop_id is distinct from v_shop_id
      or ar.organization_id is distinct from v_org_id
      or (v_shop_name is not null and ar.shop_name is distinct from v_shop_name)
    );

  get diagnostics v_updated = row_count;

  return jsonb_build_object ('ok', true, 'updated', v_updated);
end;
$$;

revoke all on function public.sync_agent_referral_shop_context () from public;
grant execute on function public.sync_agent_referral_shop_context () to authenticated;
