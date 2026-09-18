-- Waka POS — Hospitality business type validation fix
--
-- Bug: migration 20260918003000_hospitality_business_type added 'hospitality'
-- to the shops / organizations CHECK constraints but did NOT update
-- public.is_valid_shop_business_type (created in 078, called by
-- save_owner_business_profile_bundle, admin_shop_update_profile,
-- internal-ops hardening 079, platform visibility 092, and the enterprise
-- subscription foundation 134). Result: any write path that validates the
-- business type rejected 'hospitality' with invalid_business_type —
-- admins could not switch a shop to Hospitality from the internal admin
-- console, and hospitality merchants could not save their business profile.
--
-- This migration brings the validator in line with the CHECK constraints.

create or replace function public.is_valid_shop_business_type (p_type text)
returns boolean
language sql
immutable
as $$
  select coalesce (
    nullif (trim (p_type), '') in (
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
    ),
    false
  );
$$;
