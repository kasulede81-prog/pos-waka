-- Reconstructed from production.
--
-- Recovered verbatim from supabase_migrations.schema_migrations.statements for
-- version 20260925070409 (name: loyalty_wallet_enqueue_on_account_state_change), which is APPLIED in production. Filed under its exact
-- production version so local history matches what production actually ran and the
-- CLI does not treat it as pending. No production schema was changed to create this.
--

-- Re-sync a member's Google Wallet card when their STATUS or MEMBERSHIP EXPIRY
-- changes (suspend / reactivate / revoke / renew) so the card's ACTIVE/INACTIVE
-- state stays current. Balance-only changes are intentionally excluded here —
-- those already enqueue via the loyalty_transactions trigger, so this avoids
-- double work. Object-level only; the shared class is never touched.
-- Fail-safe: never blocks the account update.
create or replace function public.loyalty_wallet_enqueue_on_account_state_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.google_wallet_object_id is null then
    return new;
  end if;

  if (new.status is distinct from old.status)
     or (new.membership_expires_at is distinct from old.membership_expires_at)
  then
    insert into public.loyalty_wallet_sync_outbox (
      shop_id, account_id, balance_points, reason, source_ref
    )
    values (
      new.shop_id,
      new.id,
      greatest(0, coalesce(new.balance_points, 0)),
      'account_state',
      'acctstate:' || new.id::text || ':'
        || coalesce(new.status, 'null') || ':'
        || coalesce(new.membership_expires_at::text, 'none')
    )
    on conflict (source_ref) do nothing;
  end if;

  return new;
exception
  when others then
    return new;
end;
$function$;

drop trigger if exists trg_loyalty_wallet_enqueue_on_account_state on public.loyalty_accounts;
create trigger trg_loyalty_wallet_enqueue_on_account_state
after update on public.loyalty_accounts
for each row
execute function public.loyalty_wallet_enqueue_on_account_state_change();

