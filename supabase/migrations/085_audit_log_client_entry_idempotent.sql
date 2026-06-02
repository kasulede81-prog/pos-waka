-- Idempotent client audit mirror: one cloud row per local audit entry per shop.

create unique index if not exists audit_logs_shop_client_entry_unique
  on public.audit_logs (shop_id, client_entry_id)
  where client_entry_id is not null;

comment on index public.audit_logs_shop_client_entry_unique is
  'Prevents duplicate audit rows when the same device replays audit_log sync operations.';
