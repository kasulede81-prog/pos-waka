-- Registration defaults: do not enable hardware/electronics (and other experimental types) until admin turns them on.
-- Fixes shops where experimental types stayed enabled but admin could not see toggles.

create or replace function public.platform_default_business_types_enabled ()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array (
    'kiosk_duka',
    'boutique',
    'pharmacy',
    'wholesale',
    'restaurant',
    'bar',
    'restaurant_bar',
    'hotel',
    'mobile_money_agent',
    'other'
  );
$$;

-- Strip experimental types from stored enabled list (one-time alignment).
update public.platform_settings ps
set
  value = (
    select coalesce(jsonb_agg(to_jsonb (elem)), '[]'::jsonb)
    from jsonb_array_elements_text (ps.value) elem
    where elem not in (
      'hardware',
      'electronics',
      'salon',
      'produce_market',
      'mini_supermarket'
    )
  ),
  updated_at = now ()
where ps.key = 'business_types_enabled'
  and jsonb_typeof (ps.value) = 'array';
