-- Reconstructed from production.
--
-- Recovered verbatim from supabase_migrations.schema_migrations.statements for
-- version 20260925070315 (name: loyalty_wallet_cron_drain), which is APPLIED in production. Filed under its exact
-- production version so local history matches what production actually ran and the
-- CLI does not treat it as pending. No production schema was changed to create this.
--

-- Server-side drain: every minute, if the outbox has work, POST the sync edge
-- function with the service-role key (read from Vault). This makes ANY change
-- (sale or settings) reach cards automatically even when no one is watching.
create or replace function public.loyalty_wallet_drain_tick()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key text;
  v_url text := 'https://ljaedextsenbkxzzgxcg.supabase.co/functions/v1/loyalty-wallet-sync';
begin
  -- Nothing to do → don't wake the edge function at all.
  if not exists (
    select 1 from public.loyalty_wallet_sync_outbox
    where status in ('pending','failed') and attempts < 8
  ) then
    return;
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'wallet_sync_service_key'
  limit 1;

  -- Key not stored yet → no-op (the merchant-side nudge still works).
  if v_key is null or length(trim(v_key)) = 0 then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('limit', 50),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key
    ),
    timeout_milliseconds := 120000
  );
exception
  when others then
    -- Never let a drain error surface; the next tick retries.
    return;
end;
$function$;

select cron.schedule(
  'loyalty-wallet-drain',
  '* * * * *',
  $$select public.loyalty_wallet_drain_tick();$$
);

