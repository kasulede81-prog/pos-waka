-- Ask WAKA: allow usage log kind for ask_waka_chat
-- ai_generation_usage_log originally restricted kind to product/business/bulk only.

alter table public.ai_generation_usage_log
  drop constraint if exists ai_generation_usage_log_kind_check;

alter table public.ai_generation_usage_log
  add constraint ai_generation_usage_log_kind_check
  check (
    kind in (
      'product_suggest',
      'business_setup',
      'bulk_inventory',
      'ask_waka_chat'
    )
  );
