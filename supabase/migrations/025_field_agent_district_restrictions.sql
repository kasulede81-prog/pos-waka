-- Waka POS — field_agent restrictions: only view shops and field visits in assigned districts / own visits

-- Update shops_select so field agents can only see shops in their assigned districts.
drop policy if exists shops_select on public.shops;
create policy shops_select
  on public.shops for select
  using (
    public.user_can_access_shop (id)
    or (
      public.is_waka_internal_staff ()
      and (
        not public.is_waka_internal_role (array['field_agent']::text[])
        or district_id = any (public.waka_internal_my_districts ())
      )
    )
  );

-- Update field_visits access so field agents only see their own assigned visits.
drop policy if exists field_visits_internal_all on public.field_visits;
create policy field_visits_internal_all
  on public.field_visits
  for all
  using (
    public.is_waka_internal_staff ()
    and (
      not public.is_waka_internal_role (array['field_agent']::text[])
      or field_agent_internal_admin_id = (
        select ia.id
        from public.internal_admins ia
        where ia.user_id = auth.uid ()
          and ia.active = true
        limit 1
      )
    )
  )
  with check (
    public.is_waka_internal_staff ()
    and (
      not public.is_waka_internal_role (array['field_agent']::text[])
      or field_agent_internal_admin_id = (
        select ia.id
        from public.internal_admins ia
        where ia.user_id = auth.uid ()
          and ia.active = true
        limit 1
      )
    )
  );

