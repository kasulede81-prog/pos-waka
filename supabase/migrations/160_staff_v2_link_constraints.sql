-- STAFF-V2-PHASE-4: one linked Auth identity per employment profile per shop.
-- Does not change PIN login, shop_members, invitations, RLS, RPCs, or sales sync.
-- Does not write user_id. Legacy PIN rows (user_id NULL) stay allowed.

comment on column public.shop_pos_staff.user_id is
  'STAFF-V2 link. NULL = legacy PIN-only staff. UUID = linked Auth identity for this shop. One Auth user per shop; the same Auth user may link in other shops. Not a global unique identity.';

create unique index if not exists shop_pos_staff_shop_user_id_uidx
  on public.shop_pos_staff (shop_id, user_id)
  where user_id is not null;
