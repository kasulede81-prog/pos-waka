-- Waka POS — Allow shop POS "owner" role to manage shop rows (profile save, GPS, etc.).
-- Previously user_can_manage_shop only allowed shop "manager" OR org owner/admin via organization_members.
-- Bootstrap creates shop_members.role = 'owner', which did NOT pass the shop_members branch, and if org
-- membership were ever missing/mis-synced, shop UPDATE would fail (business profile save).

create or replace function public.user_can_manage_shop (p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = p_shop
      and sm.user_id = auth.uid ()
      and sm.role in ('owner', 'manager')
  )
  or exists (
    select 1
    from public.shops sh
    join public.organization_members om on om.organization_id = sh.organization_id
    where sh.id = p_shop
      and om.user_id = auth.uid ()
      and om.role in ('owner', 'admin')
  );
$$;

comment on function public.user_can_manage_shop (uuid) is
  'True if the user may update shop settings: shop owner/manager, or org owner/admin.';
