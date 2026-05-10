-- Waka POS — SaaS plan catalog (UGX), annual ≈ 10× monthly (≈2 months free / year)

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
    'small_shop',
    'Small shop',
    'Single counter kiosk & micro retail — inventory, POS, receipts.',
    37000,
    370000,
    'Annual billing ≈ 10× monthly (≈2 months free vs monthly × 12).',
    round((1::numeric - 10::numeric / 12) * 100, 2),
    14,
    2,
    10,
    '{"pos": true, "inventory": true, "receipts": true}'::jsonb
  ),
  (
    'wholesale',
    'Wholesale',
    'Multi-aisle stock, bulk pricing patterns, higher staff headcount.',
    100000,
    1000000,
    'Annual billing ≈ 10× monthly (≈2 months free vs monthly × 12).',
    round((1::numeric - 10::numeric / 12) * 100, 2),
    14,
    5,
    40,
    '{"pos": true, "inventory": true, "receipts": true, "multi_location": true}'::jsonb
  ),
  (
    'supermarket',
    'Supermarket',
    'High throughput lanes, departments, and large teams.',
    150000,
    1500000,
    'Annual billing ≈ 10× monthly (≈2 months free vs monthly × 12).',
    round((1::numeric - 10::numeric / 12) * 100, 2),
    14,
    25,
    200,
    '{"pos": true, "inventory": true, "receipts": true, "multi_location": true, "departments": true}'::jsonb
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
