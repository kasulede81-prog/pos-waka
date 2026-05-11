-- Waka POS — Uganda-first SaaS plans, shop-scoped subscription row, 30-day Business trial on signup

-- ---------- subscriptions: shop anchor + wider lifecycle statuses ----------
alter table public.subscriptions
  add column if not exists shop_id uuid references public.shops (id) on delete set null;

create index if not exists subscriptions_shop_idx on public.subscriptions (shop_id);

alter table public.subscriptions
  drop constraint if exists subscriptions_status_check;

alter table public.subscriptions
  add constraint subscriptions_status_check check (
    status in (
      'trial',
      'trialing',
      'active',
      'expired',
      'past_due',
      'cancelled',
      'canceled',
      'paused'
    )
  );

drop index if exists public.subscriptions_one_active_per_org;

create unique index if not exists subscriptions_one_active_per_org
  on public.subscriptions (organization_id)
  where status in ('trial', 'trialing', 'active', 'past_due');

-- ---------- Plan catalog: starter, business, waka_plus (UGX / month) ----------
insert into public.subscription_plans (
  code,
  name,
  description,
  monthly_price_ugx,
  annual_price_ugx,
  annual_savings_note,
  annual_discount_percent,
  trial_days,
  max_shops,
  max_pos_users,
  features
)
values
  (
    'starter',
    'Starter',
    'Single shop, one device — sell, stock, debts, offline, receipts.',
    25000,
    250000,
    'About 10 months for the price of 12 when you pay yearly.',
    round((1::numeric - 10::numeric / 12) * 100, 2),
    0,
    1,
    1,
    '{"tier":"starter","devices":1,"staff":0}'::jsonb
  ),
  (
    'business',
    'Business',
    'Staff, shifts, owner tools, cloud sync, deeper reports.',
    56000,
    560000,
    'About 10 months for the price of 12 when you pay yearly.',
    round((1::numeric - 10::numeric / 12) * 100, 2),
    30,
    3,
    5,
    '{"tier":"business","devices":3,"staff":5}'::jsonb
  ),
  (
    'waka_plus',
    'Waka Plus',
    'Growing chains — more devices, branches, and priority help.',
    110000,
    1100000,
    'About 10 months for the price of 12 when you pay yearly.',
    round((1::numeric - 10::numeric / 12) * 100, 2),
    0,
    999,
    9999,
    '{"tier":"waka_plus","devices":999,"staff":999}'::jsonb
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  monthly_price_ugx = excluded.monthly_price_ugx,
  annual_price_ugx = excluded.annual_price_ugx,
  annual_savings_note = excluded.annual_savings_note,
  annual_discount_percent = excluded.annual_discount_percent,
  trial_days = excluded.trial_days,
  max_shops = excluded.max_shops,
  max_pos_users = excluded.max_pos_users,
  features = excluded.features,
  is_active = true;

-- ---------- Bootstrap: provision Business trial subscription ----------
create or replace function public.bootstrap_owner_workspace (
  p_org_name text,
  p_business_type text default 'kiosk_duka',
  p_full_name text default null,
  p_email text default null
) returns table (
  organization_id uuid,
  shop_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_org_id uuid;
  v_shop_id uuid;
  v_business_type text := coalesce(nullif(trim(p_business_type), ''), 'kiosk_duka');
  v_plan_id uuid;
  v_trial_end timestamptz := (now() at time zone 'Africa/Kampala') + interval '30 days';
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if v_business_type not in (
    'kiosk_duka','wholesale','mini_supermarket','hardware','restaurant','salon',
    'pharmacy','boutique','electronics','produce_market','mobile_money_agent','other'
  ) then
    v_business_type := 'kiosk_duka';
  end if;

  insert into public.profiles (id, full_name, business_name, email, role)
  values (
    v_uid,
    nullif(trim(p_full_name), ''),
    nullif(trim(p_org_name), ''),
    nullif(lower(trim(p_email)), ''),
    'owner'
  )
  on conflict (id) do update
  set full_name = coalesce(excluded.full_name, public.profiles.full_name),
      business_name = coalesce(excluded.business_name, public.profiles.business_name),
      email = coalesce(excluded.email, public.profiles.email),
      role = 'owner',
      updated_at = now();

  select om.organization_id
  into v_org_id
  from public.organization_members om
  where om.user_id = v_uid
  order by om.created_at asc
  limit 1;

  if v_org_id is null then
    insert into public.organizations (name, business_type, created_by)
    values (coalesce(nullif(trim(p_org_name), ''), 'My Shop'), v_business_type, v_uid)
    returning id into v_org_id;
  end if;

  insert into public.organization_members (organization_id, user_id, profile_id, role)
  values (v_org_id, v_uid, v_uid, 'owner')
  on conflict (organization_id, user_id) do update
  set role = 'owner',
      profile_id = coalesce(public.organization_members.profile_id, excluded.profile_id);

  select s.id
  into v_shop_id
  from public.shops s
  where s.organization_id = v_org_id
  order by s.created_at asc
  limit 1;

  if v_shop_id is null then
    insert into public.shops (organization_id, name, business_type, is_active)
    values (v_org_id, coalesce(nullif(trim(p_org_name), ''), 'Main Shop'), v_business_type, true)
    returning id into v_shop_id;
  end if;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_shop_id, v_uid, 'owner')
  on conflict (shop_id, user_id) do update
  set role = 'owner';

  select sp.id
  into v_plan_id
  from public.subscription_plans sp
  where sp.code = 'business'
    and sp.is_active
  limit 1;

  if v_plan_id is not null then
    if not exists (
      select 1
      from public.subscriptions s
      where s.organization_id = v_org_id
    ) then
      insert into public.subscriptions (
        organization_id,
        shop_id,
        plan_id,
        status,
        billing_interval,
        trial_ends_at,
        current_period_start,
        current_period_end,
        external_provider
      )
      values (
        v_org_id,
        v_shop_id,
        v_plan_id,
        'trial',
        'month',
        v_trial_end,
        now(),
        v_trial_end,
        'trial_auto'
      );
    end if;
  end if;

  return query select v_org_id, v_shop_id;
end;
$$;

grant execute on function public.bootstrap_owner_workspace (text, text, text, text) to authenticated;

-- ---------- Backfill: orgs without a subscription get the same Business trial ----------
insert into public.subscriptions (
  organization_id,
  shop_id,
  plan_id,
  status,
  billing_interval,
  trial_ends_at,
  current_period_start,
  current_period_end,
  external_provider
)
select
  o.id,
  s.id,
  sp.id,
  'trial',
  'month',
  (now() at time zone 'Africa/Kampala') + interval '30 days',
  now(),
  (now() at time zone 'Africa/Kampala') + interval '30 days',
  'trial_backfill'
from public.organizations o
join lateral (
  select sh.id
  from public.shops sh
  where sh.organization_id = o.id
  order by sh.created_at asc
  limit 1
) s on true
cross join lateral (
  select sp2.id
  from public.subscription_plans sp2
  where sp2.code = 'business'
    and sp2.is_active
  limit 1
) sp
where exists (select 1 from public.shops sh2 where sh2.organization_id = o.id)
  and not exists (
    select 1 from public.subscriptions sub where sub.organization_id = o.id
  );

comment on column public.subscriptions.shop_id is 'Primary shop this subscription row was created for; billing is org-scoped.';
