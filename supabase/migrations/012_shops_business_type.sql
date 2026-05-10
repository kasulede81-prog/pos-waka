-- Waka POS — shop business profile for adaptive UI / reporting (synced when online)

alter table public.shops
  add column if not exists business_type text not null default 'kiosk_duka';

alter table public.shops drop constraint if exists shops_business_type_check;

alter table public.shops
  add constraint shops_business_type_check check (
    business_type in (
      'kiosk_duka',
      'wholesale',
      'mini_supermarket',
      'hardware',
      'restaurant',
      'salon',
      'pharmacy',
      'boutique',
      'electronics',
      'produce_market',
      'mobile_money_agent',
      'other'
    )
  );

comment on column public.shops.business_type is 'Vendor-selected profile; client mirrors in local prefs for offline-first UX.';
