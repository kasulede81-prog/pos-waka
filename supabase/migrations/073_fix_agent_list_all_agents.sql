-- Restore internal agent list: show all agents (active + inactive), not only active=true.
-- Empty admin panel often means every row was inactive or the RPC errored silently on the client.

create or replace function public.internal_list_marketing_agents ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  return coalesce (
    (
      select jsonb_agg (
        jsonb_build_object (
          'id', ma.id,
          'referral_code', ma.referral_code,
          'full_name', ma.full_name,
          'email', ma.email,
          'phone_e164', ma.phone_e164,
          'active', ma.active,
          'roles', ma.roles,
          'referral_count', (select count(*)::int from public.agent_referrals ar where ar.agent_id = ma.id),
          'created_at', ma.created_at,
          'shop_id', own.shop_id,
          'shop_name', own.shop_name,
          'user_id', ma.user_id,
          'credential_expires_at', ma.credential_expires_at
        )
        order by ma.active desc, ma.created_at desc
      )
      from public.marketing_agents ma
      left join lateral (
        select s.id as shop_id, s.name as shop_name
        from public.shop_members sm
        join public.shops s on s.id = sm.shop_id
        where sm.user_id = ma.user_id
        order by (case when sm.role = 'owner' then 0 else 1 end), sm.created_at asc
        limit 1
      ) own on true
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.internal_list_marketing_agents () from public;
grant execute on function public.internal_list_marketing_agents () to authenticated;
