-- Subscription plan repackaging: prices, limits, and feature JSON (May 2026).

update public.subscription_plans
set
  name = 'Free Mode',
  description = 'Try Waka POS and run a very small shop.',
  monthly_price_ugx = 0,
  annual_price_ugx = 0,
  annual_savings_note = 'Free Mode has no annual charge.',
  max_shops = 1,
  max_pos_users = 1,
  features = '{"tier":"free","devices":1,"staff":0,"users":1,"products":7}'::jsonb,
  is_active = true
where code = 'free';

update public.subscription_plans
set
  name = 'Starter',
  description = 'For owners who run the shop themselves — unlimited products, backup, and profit reports.',
  monthly_price_ugx = 25000,
  annual_price_ugx = 250000,
  annual_savings_note = 'Save UGX 50,000 vs paying monthly',
  max_shops = 1,
  max_pos_users = 1,
  features = '{"tier":"starter","devices":1,"staff":0,"users":1,"products":null}'::jsonb,
  is_active = true
where code = 'starter';

update public.subscription_plans
set
  name = 'Business',
  description = 'Staff accounts, owner dashboard, and up to 3 devices.',
  monthly_price_ugx = 49000,
  annual_price_ugx = 490000,
  annual_savings_note = 'Save UGX 98,000 vs paying monthly',
  max_shops = 3,
  max_pos_users = 3,
  features = '{"tier":"business","devices":3,"staff":3,"users":3}'::jsonb,
  is_active = true
where code = 'business';

update public.subscription_plans
set
  name = 'Waka Plus',
  description = 'Higher limits and priority support for larger businesses.',
  monthly_price_ugx = 99000,
  annual_price_ugx = 990000,
  annual_savings_note = 'Save UGX 198,000 vs paying monthly',
  max_shops = 999,
  max_pos_users = 10,
  features = '{"tier":"waka_plus","devices":10,"staff":10,"users":10}'::jsonb,
  is_active = true
where code = 'waka_plus';
