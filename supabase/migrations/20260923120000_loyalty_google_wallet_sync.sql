-- Phase 5 — Google Wallet balance sync outbox
-- Downstream of loyalty ledger. Failures never touch sales or points.

create table if not exists public.loyalty_wallet_sync_outbox (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  account_id uuid not null references public.loyalty_accounts (id) on delete cascade,
  balance_points integer not null check (balance_points >= 0),
  reason text not null,
  source_ref text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  unique (source_ref)
);

create index if not exists loyalty_wallet_sync_outbox_pending_idx
  on public.loyalty_wallet_sync_outbox (status, created_at)
  where status in ('pending', 'failed');

create index if not exists loyalty_wallet_sync_outbox_account_idx
  on public.loyalty_wallet_sync_outbox (account_id, created_at desc);

alter table public.loyalty_accounts
  add column if not exists google_wallet_object_id text,
  add column if not exists google_wallet_issued_at timestamptz,
  add column if not exists google_wallet_synced_at timestamptz,
  add column if not exists google_wallet_sync_balance integer;

comment on column public.loyalty_accounts.google_wallet_object_id is
  'Deterministic Google Wallet object resource id (issuerId.acct_<account_uuid>).';

alter table public.loyalty_wallet_sync_outbox enable row level security;

drop policy if exists loyalty_wallet_sync_outbox_select on public.loyalty_wallet_sync_outbox;
create policy loyalty_wallet_sync_outbox_select
  on public.loyalty_wallet_sync_outbox
  for select
  to authenticated
  using (public.user_can_access_shop (shop_id));

revoke all on table public.loyalty_wallet_sync_outbox from anon;
revoke all on table public.loyalty_wallet_sync_outbox from authenticated;
grant select on table public.loyalty_wallet_sync_outbox to authenticated;
grant all on table public.loyalty_wallet_sync_outbox to service_role;

create or replace function public.loyalty_wallet_enqueue_sync ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop_id uuid;
  v_balance integer;
begin
  select a.shop_id, coalesce(new.balance_after, a.balance_points)
    into v_shop_id, v_balance
  from public.loyalty_accounts a
  where a.id = new.account_id;

  if v_shop_id is null then
    return new;
  end if;

  insert into public.loyalty_wallet_sync_outbox (
    shop_id,
    account_id,
    balance_points,
    reason,
    source_ref
  )
  values (
    v_shop_id,
    new.account_id,
    greatest(0, coalesce(v_balance, 0)),
    coalesce(nullif(trim(new.cause), ''), new.kind, 'ledger'),
    new.id::text
  )
  on conflict (source_ref) do nothing;

  return new;
exception
  when others then
    -- Wallet sync must never fail the loyalty ledger write.
    return new;
end;
$$;

drop trigger if exists trg_loyalty_wallet_enqueue_sync on public.loyalty_transactions;
create trigger trg_loyalty_wallet_enqueue_sync
  after insert on public.loyalty_transactions
  for each row
  execute function public.loyalty_wallet_enqueue_sync ();

revoke all on function public.loyalty_wallet_enqueue_sync () from public;
revoke all on function public.loyalty_wallet_enqueue_sync () from anon;
revoke all on function public.loyalty_wallet_enqueue_sync () from authenticated;
