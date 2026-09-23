-- Phase 3 — Customer-facing loyalty card access token.
-- Separates web card URL access from POS checkout QR identity (qr_token).
-- Does NOT modify qr_token, balances, ledger, award, or redeem logic.

create or replace function public.loyalty_generate_public_card_token ()
returns text
language sql
volatile
as $fn$
  -- Two UUID v4 values concatenated (hyphens stripped) → 64 hex chars.
  -- Opaque; not derived from phone, customer id, or qr_token.
  select replace(gen_random_uuid ()::text || gen_random_uuid ()::text, '-', '');
$fn$;

revoke all on function public.loyalty_generate_public_card_token () from public;
revoke all on function public.loyalty_generate_public_card_token () from anon;
revoke all on function public.loyalty_generate_public_card_token () from authenticated;

alter table public.loyalty_accounts
  add column if not exists public_card_token text;

-- Backfill existing rows before enforcing NOT NULL / UNIQUE.
update public.loyalty_accounts
set public_card_token = public.loyalty_generate_public_card_token ()
where public_card_token is null
   or btrim(public_card_token) = '';

-- Extremely unlikely collision loop (unique will catch leftovers).
do $backfill$
declare
  n int;
begin
  loop
    select count(*) into n
    from (
      select public_card_token
      from public.loyalty_accounts
      group by public_card_token
      having count(*) > 1
    ) dups;
    exit when n = 0;
    update public.loyalty_accounts a
    set public_card_token = public.loyalty_generate_public_card_token ()
    where a.ctid in (
      select ctid
      from (
        select ctid,
          row_number() over (partition by public_card_token order by id) as rn
        from public.loyalty_accounts
      ) x
      where x.rn > 1
    );
  end loop;
end;
$backfill$;

alter table public.loyalty_accounts
  alter column public_card_token set default public.loyalty_generate_public_card_token ();

alter table public.loyalty_accounts
  alter column public_card_token set not null;

do $uniq$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'loyalty_accounts_public_card_token_key'
  ) then
    alter table public.loyalty_accounts
      add constraint loyalty_accounts_public_card_token_key unique (public_card_token);
  end if;
end;
$uniq$;

create unique index if not exists loyalty_accounts_public_card_token_uidx
  on public.loyalty_accounts (public_card_token);

comment on column public.loyalty_accounts.public_card_token is
  'Opaque token for public customer loyalty page URL. Independent from qr_token (POS identity).';

-- Safety: never allow anon table access (already revoked; re-assert).
revoke all on public.loyalty_accounts from anon;
