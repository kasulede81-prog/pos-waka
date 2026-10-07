-- ============================================================================
-- M3-G — SUBSCRIPTION LIFECCYCLE TICK (expiry / grace / lapse / reminders)
-- ============================================================================
-- M3-G audit findings addressed (all PROVEN):
--   * NO server-side expiry/grace/renewal-reminder job existed — the client
--     processExpiry / processGracePeriod / processRenewalReminder helpers are
--     only ever called from tests, so no row ever transitioned;
--   * cancelled / paused / past_due subscriptions never lapsed anywhere —
--     they kept paid-tier entitlement forever.
--
-- This migration provides ONE server-side function, `subscription_lifecycle_tick`,
-- scheduled with pg_cron (guarded: environments without pg_cron simply skip
-- scheduling — the function stays directly callable, e.g. from ops tooling
-- or tests). Semantics deliberately mirror the existing client evaluators in
-- src/lib/subscriptionAutomation.ts (the ONLY existing lifecycle logic):
--
--   trial/trialing + trial ended          → expired      (evaluator: trial_ended)
--   active + period ended, no grace       → expired      (evaluator: period_ended)
--   active + period ended, within grace   → past_due     (evaluator: grace window)
--   past_due + grace over                 → expired      (audit: past_due dead-end fixed)
--   cancelled/paused + period ended       → expired      (audit: indefinite entitlement fixed)
--   renewal reminder days reached         → 'renewal_reminder' history row (once per
--                                            period_end + day, deduped)
--
-- The client resolver (effectiveSubscription.ts) is updated in the same phase
-- to lapse cancelled/paused/past_due rows whose period has ended even before
-- the tick converges the row — entitlement is computed, this converges state.
--
-- NO automatic refunds, no plan changes, no money movement.

create or replace function public.subscription_lifecycle_tick (
  p_grace_days int default null,
  p_reminder_days int[] default null,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce (p_now, now ());
  v_grace int := p_grace_days;
  v_reminders int[] := p_reminder_days;
  v_expired int := 0;
  v_graced int := 0;
  v_lapsed int := 0;
  v_reminders_sent int := 0;
  rec record;
  v_days int;
  v_end timestamptz;
begin
  -- Settings: explicit params win, else the platform settings row (135), else
  -- the shipped defaults (grace 0, reminders 7/3/1).
  if v_grace is null then
    v_grace := 0;
    if to_regclass ('public.platform_settings') is not null then
      select coalesce ((ps.value ->> 'gracePeriodDays')::int, 0)
        into v_grace
      from public.platform_settings ps
      where ps.key = 'subscription_settings';
      v_grace := coalesce (v_grace, 0);
    end if;
  end if;

  if v_reminders is null then
    v_reminders := array[7, 3, 1];
    if to_regclass ('public.platform_settings') is not null then
      select coalesce (
               (select array_agg (e.value::int)
                  from jsonb_array_elements_text (
                         coalesce (ps.value -> 'subscriptionReminderDays', '[]'::jsonb)
                       ) e (value)),
               array[]::int[]
             )
        into v_reminders
      from public.platform_settings ps
      where ps.key = 'subscription_settings';
      v_reminders := coalesce (v_reminders, array[]::int[]);
    end if;
  end if;

  -- 1. Ended trials → expired.
  for rec in
    select s.id, s.shop_id
      from public.subscriptions s
     where s.status in ('trial', 'trialing')
       and s.trial_ends_at is not null
       and s.trial_ends_at <= v_now
     for update skip locked
  loop
    update public.subscriptions s
       set status = 'expired',
           updated_at = now ()
     where s.id = rec.id and s.status in ('trial', 'trialing');
    if found then
      perform public._internal_subscription_history_write (
        rec.id, 'subscription_expired', 'Trial ended',
        jsonb_build_object ('from_status', 'trial', 'at', v_now)
      );
      v_expired := v_expired + 1;
    end if;
  end loop;

  -- 2. Active rows past period end → past_due (within grace) or expired.
  for rec in
    select s.id, s.shop_id, s.current_period_end
      from public.subscriptions s
     where s.status = 'active'
       and s.current_period_end is not null
       and s.current_period_end <= v_now
     for update skip locked
  loop
    if v_grace > 0 and v_now < rec.current_period_end + make_interval (days => v_grace) then
      update public.subscriptions s
         set status = 'past_due',
             updated_at = now ()
       where s.id = rec.id and s.status = 'active';
      if found then
        perform public._internal_subscription_history_write (
          rec.id, 'subscription_grace',
          format ('Grace period until %s', rec.current_period_end + make_interval (days => v_grace)),
          jsonb_build_object ('grace_days', v_grace, 'period_end', rec.current_period_end)
        );
        v_graced := v_graced + 1;
      end if;
    else
      update public.subscriptions s
         set status = 'expired',
             updated_at = now ()
       where s.id = rec.id and s.status = 'active';
      if found then
        perform public._internal_subscription_history_write (
          rec.id, 'subscription_expired', 'Subscription period ended',
          jsonb_build_object ('from_status', 'active', 'period_end', rec.current_period_end)
        );
        v_expired := v_expired + 1;
      end if;
    end if;
  end loop;

  -- 3. past_due whose grace window has ended → expired (audit: dead-end fix).
  for rec in
    select s.id, s.shop_id, s.current_period_end
      from public.subscriptions s
     where s.status = 'past_due'
       and s.current_period_end is not null
       and s.current_period_end + make_interval (days => greatest (v_grace, 0)) <= v_now
     for update skip locked
  loop
    update public.subscriptions s
       set status = 'expired',
           updated_at = now ()
     where s.id = rec.id and s.status = 'past_due';
    if found then
      perform public._internal_subscription_history_write (
        rec.id, 'subscription_expired', 'Grace period ended',
        jsonb_build_object ('from_status', 'past_due', 'period_end', rec.current_period_end)
      );
      v_expired := v_expired + 1;
    end if;
  end loop;

  -- 4. cancelled / paused rows whose paid period ended → expired (converges
  --    the row; the resolver already lapses them at period end). Paid time
  --    still inside the period is honoured — nothing is cut short early.
  for rec in
    select s.id, s.shop_id, s.current_period_end, s.status
      from public.subscriptions s
     where s.status in ('cancelled', 'canceled', 'paused')
       and s.current_period_end is not null
       and s.current_period_end <= v_now
     for update skip locked
  loop
    update public.subscriptions s
       set status = 'expired',
           updated_at = now (),
           metadata = coalesce (s.metadata, '{}'::jsonb)
             || jsonb_build_object ('lapsed_from_status', s.status)
     where s.id = rec.id
       and s.status in ('cancelled', 'canceled', 'paused');
    if found then
      perform public._internal_subscription_history_write (
        rec.id, 'subscription_expired', 'Lapsed after period end',
        jsonb_build_object ('from_status', rec.status, 'period_end', rec.current_period_end)
      );
      v_lapsed := v_lapsed + 1;
    end if;
  end loop;

  -- 5. Renewal reminders (once per period_end + day, deduped via history).
  if coalesce (array_length (v_reminders, 1), 0) > 0 then
    for rec in
      select s.id, s.shop_id, s.current_period_end, s.status
        from public.subscriptions s
       where s.status in ('active', 'trial', 'trialing', 'past_due')
         and s.shop_id is not null
         and s.current_period_end is not null
         and s.current_period_end > v_now
       for update skip locked
    loop
      v_end := rec.current_period_end;
      v_days := ceil ((extract (epoch from (v_end - v_now)) / 86400)::numeric)::int;
      if v_days <= 0 or not (v_days = any (v_reminders)) then
        continue;
      end if;
      if exists (
        select 1
        from public.subscription_history h
        where h.subscription_id = rec.id
          and h.action = 'renewal_reminder'
          and h.payload ->> 'days_remaining' = v_days::text
          and h.payload ->> 'period_end' = v_end::text
      ) then
        continue;
      end if;
      perform public._internal_subscription_history_write (
        rec.id,
        'renewal_reminder',
        format ('Renewal in %s day(s)', v_days),
        -- period_end stored as TEXT so the dedupe comparison below compares
        -- like with like (jsonb's timestamptz rendering ≠ timestamptz::text).
        jsonb_build_object ('days_remaining', v_days, 'period_end', v_end::text)
      );
      v_reminders_sent := v_reminders_sent + 1;
    end loop;
  end if;

  return jsonb_build_object (
    'ok', true,
    'expired', v_expired,
    'grace_marked', v_graced,
    'lapsed', v_lapsed,
    'reminders', v_reminders_sent,
    'ran_at', v_now
  );
end;
$$;

revoke all on function public.subscription_lifecycle_tick (int, int[], timestamptz) from public;
revoke all on function public.subscription_lifecycle_tick (int, int[], timestamptz) from anon;
grant execute on function public.subscription_lifecycle_tick (int, int[], timestamptz) to authenticated;

do $service$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.subscription_lifecycle_tick (int, int[], timestamptz) to service_role';
  end if;
end;
$service$;

-- ---------------------------------------------------------------------------
-- Scheduled mechanism (pg_cron when available; skipped elsewhere — e.g. the
-- PGlite test harness — where the function remains directly callable).
-- Off-minute schedules avoid the top-of-hour thundering herd.
-- ---------------------------------------------------------------------------
do $cron$
begin
  if to_regclass ('cron.job') is not null
     and to_regprocedure ('cron.schedule(text,text,text)') is not null then
    if not exists (
      select 1 from cron.job j where j.jobname = 'm3g-subscription-lifecycle'
    ) then
      perform cron.schedule (
        'm3g-subscription-lifecycle',
        '23 * * * *',
        'select public.subscription_lifecycle_tick ();'
      );
    end if;
    if not exists (
      select 1 from cron.job j where j.jobname = 'm3g-payment-reconciliation'
    ) then
      perform cron.schedule (
        'm3g-payment-reconciliation',
        '11,26,41,56 * * * *',
        'select public.subscription_payment_reconcile_tick ();'
      );
    end if;
  end if;
end;
$cron$;
