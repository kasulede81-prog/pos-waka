-- Waka POS — Hospitality business type consolidation
--
-- ONE unified Hospitality business type. Restaurant / Bar / Restaurant + Bar
-- become an operating configuration (ShopPreferences.hospitalityStyle), not
-- separate business architectures. Legacy stored values stay valid — existing
-- merchants keep loading exactly as before (no data rewrite).

alter table public.shops drop constraint if exists shops_business_type_check;
alter table public.shops
  add constraint shops_business_type_check check (
    business_type in (
      'kiosk_duka',
      'wholesale',
      'mini_supermarket',
      'hardware',
      'hospitality',
      'restaurant',
      'bar',
      'restaurant_bar',
      'hotel',
      'salon',
      'pharmacy',
      'boutique',
      'electronics',
      'produce_market',
      'mobile_money_agent',
      'other'
    )
  );

alter table public.organizations drop constraint if exists organizations_business_type_check;
alter table public.organizations
  add constraint organizations_business_type_check check (
    business_type in (
      'kiosk_duka',
      'wholesale',
      'mini_supermarket',
      'hardware',
      'hospitality',
      'restaurant',
      'bar',
      'restaurant_bar',
      'hotel',
      'salon',
      'pharmacy',
      'boutique',
      'electronics',
      'produce_market',
      'mobile_money_agent',
      'other'
    )
  );
