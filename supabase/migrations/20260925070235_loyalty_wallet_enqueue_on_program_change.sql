-- Reconstructed from production.
--
-- Recovered verbatim from supabase_migrations.schema_migrations.statements for
-- version 20260925070235 (name: loyalty_wallet_enqueue_on_program_change), which is APPLIED in production. Filed under its exact
-- production version so local history matches what production actually ran and the
-- CLI does not treat it as pending. No production schema was changed to create this.
--

-- When a merchant edits the loyalty program (earn rule / enabled), re-sync every
-- already-issued Google Wallet card for that shop so the card's "Earns" text and
-- balance are refreshed. Object-level only; the shared published class is untouched.
-- Fail-safe: a wallet enqueue must NEVER block or roll back a settings save.
create or replace function public.loyalty_wallet_enqueue_on_program_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Only enqueue when a field that actually shows on the card changed.
  if (new.enabled is distinct from old.enabled)
     or (new.earn_unit_ugx is distinct from old.earn_unit_ugx)
     or (new.earn_points_per_unit is distinct from old.earn_points_per_unit)
     or (new.rule_kind is distinct from old.rule_kind)
     or (new.min_eligible_spend_ugx is distinct from old.min_eligible_spend_ugx)
  then
    insert into public.loyalty_wallet_sync_outbox (
      shop_id, account_id, balance_points, reason, source_ref
    )
    select
      new.shop_id,
      a.id,
      greatest(0, coalesce(a.balance_points, 0)),
      'program_update',
      'program:' || a.id::text || ':' || extract(epoch from new.updated_at)::bigint::text
    from public.loyalty_accounts a
    where a.shop_id = new.shop_id
      and a.google_wallet_object_id is not null
    on conflict (source_ref) do nothing;
  end if;

  return new;
exception
  when others then
    -- Wallet sync must never fail the merchant's settings save.
    return new;
end;
$function$;

drop trigger if exists trg_loyalty_wallet_enqueue_on_program_change on public.loyalty_programs;
create trigger trg_loyalty_wallet_enqueue_on_program_change
after update on public.loyalty_programs
for each row
execute function public.loyalty_wallet_enqueue_on_program_change();

