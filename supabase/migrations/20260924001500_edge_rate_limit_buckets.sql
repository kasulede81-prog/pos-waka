-- Phase 3 F1/W2 — Durable Edge rate-limit buckets (abuse control only).
-- Isolated from loyalty source-of-truth. Stores hashes only (never raw tokens/IPs/Save URLs).

create table if not exists public.edge_rate_limit_buckets (
  scope text not null
    check (scope in ('card_read', 'wallet_issue')),
  dim text not null
    check (dim in ('ip', 'token')),
  key_hash text not null
    check (char_length(key_hash) >= 8 and char_length(key_hash) <= 128),
  window_start timestamptz not null,
  window_ms integer not null
    check (window_ms > 0),
  count integer not null
    check (count >= 0),
  updated_at timestamptz not null default now (),
  primary key (scope, dim, key_hash, window_start)
);

create index if not exists edge_rate_limit_buckets_window_start_idx
  on public.edge_rate_limit_buckets (window_start);

comment on table public.edge_rate_limit_buckets is
  'Short-lived fixed-window rate-limit counters for public Edge Functions. Hashes only; not loyalty authority.';

alter table public.edge_rate_limit_buckets enable row level security;

revoke all on table public.edge_rate_limit_buckets from public;
revoke all on table public.edge_rate_limit_buckets from anon;
revoke all on table public.edge_rate_limit_buckets from authenticated;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.edge_rate_limit_buckets to service_role;
  end if;
end;
$grants$;

-- Lazy purge helper (service_role / DEFINER only).
create or replace function public.edge_rate_limit_purge_expired (
  p_max_age_ms integer default 3_600_000
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n integer := 0;
  v_cutoff timestamptz;
begin
  if p_max_age_ms is null or p_max_age_ms < 60_000 then
    p_max_age_ms := 3_600_000;
  end if;
  v_cutoff := now () - make_interval (secs => (p_max_age_ms / 1000.0));
  delete from public.edge_rate_limit_buckets
  where window_start < v_cutoff;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function public.edge_rate_limit_purge_expired (integer) from public;
revoke all on function public.edge_rate_limit_purge_expired (integer) from anon;
revoke all on function public.edge_rate_limit_purge_expired (integer) from authenticated;

do $purge_grant$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.edge_rate_limit_purge_expired (integer) to service_role;
  end if;
end;
$purge_grant$;

/**
 * Atomic fixed-window consume for up to two dimensions (ip + token).
 * Abuse control only — never resolves loyalty accounts/shops.
 */
create or replace function public.edge_rate_limit_consume (
  p_scope text,
  p_ip_hash text,
  p_token_hash text,
  p_ip_limit integer,
  p_ip_window_ms integer,
  p_token_limit integer,
  p_token_window_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_now_ms bigint;
  v_ip_window_start timestamptz;
  v_token_window_start timestamptz;
  v_ip_window_start_ms bigint;
  v_token_window_start_ms bigint;
  v_ip_hash text;
  v_token_hash text;
  v_ip_ok boolean := true;
  v_token_ok boolean := true;
  v_retry integer := 1;
  v_row_count integer;
begin
  if p_scope is null or p_scope not in ('card_read', 'wallet_issue') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_scope');
  end if;

  -- Lazy cleanup (bounded; hours not months). Ignore result.
  perform public.edge_rate_limit_purge_expired (3_600_000);

  v_now_ms := (extract (epoch from clock_timestamp ()) * 1000)::bigint;

  v_ip_hash := nullif (btrim (coalesce (p_ip_hash, '')), '');
  v_token_hash := nullif (btrim (coalesce (p_token_hash, '')), '');

  if v_ip_hash is not null then
    if p_ip_limit is null or p_ip_limit < 1 or p_ip_window_ms is null or p_ip_window_ms < 1 then
      return jsonb_build_object ('ok', false, 'error', 'invalid_ip_limit');
    end if;
    perform pg_advisory_xact_lock (hashtextextended ('rl:' || p_scope || ':ip:' || v_ip_hash, 0));
    v_ip_window_start_ms := (v_now_ms / p_ip_window_ms) * p_ip_window_ms;
    v_ip_window_start := to_timestamp (v_ip_window_start_ms / 1000.0);
    v_row_count := null;

    insert into public.edge_rate_limit_buckets as b (
      scope, dim, key_hash, window_start, window_ms, count, updated_at
    )
    values (
      p_scope, 'ip', v_ip_hash, v_ip_window_start, p_ip_window_ms, 1, now ()
    )
    on conflict (scope, dim, key_hash, window_start) do update
      set count = b.count + 1,
          updated_at = now ()
      where b.count < p_ip_limit
    returning b.count into v_row_count;

    if v_row_count is null then
      v_ip_ok := false;
      v_retry := greatest (
        1,
        ceil (((v_ip_window_start_ms + p_ip_window_ms) - v_now_ms) / 1000.0)::integer
      );
    end if;
  end if;

  if not v_ip_ok then
    return jsonb_build_object (
      'ok', false,
      'error', 'rate_limited',
      'retry_after_seconds', v_retry
    );
  end if;

  if v_token_hash is not null then
    if p_token_limit is null or p_token_limit < 1 or p_token_window_ms is null or p_token_window_ms < 1 then
      -- Compensate IP if already consumed in this call.
      if v_ip_hash is not null and v_ip_ok then
        update public.edge_rate_limit_buckets
        set count = greatest (0, count - 1),
            updated_at = now ()
        where scope = p_scope
          and dim = 'ip'
          and key_hash = v_ip_hash
          and window_start = v_ip_window_start;
      end if;
      return jsonb_build_object ('ok', false, 'error', 'invalid_token_limit');
    end if;
    perform pg_advisory_xact_lock (hashtextextended ('rl:' || p_scope || ':tok:' || v_token_hash, 0));
    v_token_window_start_ms := (v_now_ms / p_token_window_ms) * p_token_window_ms;
    v_token_window_start := to_timestamp (v_token_window_start_ms / 1000.0);
    v_row_count := null;

    insert into public.edge_rate_limit_buckets as b (
      scope, dim, key_hash, window_start, window_ms, count, updated_at
    )
    values (
      p_scope, 'token', v_token_hash, v_token_window_start, p_token_window_ms, 1, now ()
    )
    on conflict (scope, dim, key_hash, window_start) do update
      set count = b.count + 1,
          updated_at = now ()
      where b.count < p_token_limit
    returning b.count into v_row_count;

    if v_row_count is null then
      v_token_ok := false;
      v_retry := greatest (
        1,
        ceil (((v_token_window_start_ms + p_token_window_ms) - v_now_ms) / 1000.0)::integer
      );
      -- Compensate IP increment so a token rejection does not burn IP quota unfairly.
      if v_ip_hash is not null then
        update public.edge_rate_limit_buckets
        set count = greatest (0, count - 1),
            updated_at = now ()
        where scope = p_scope
          and dim = 'ip'
          and key_hash = v_ip_hash
          and window_start = v_ip_window_start;
      end if;
    end if;
  elsif p_scope = 'wallet_issue' then
    -- Wallet requires token hash. Undo IP consume if we already took a slot.
    if v_ip_hash is not null and v_ip_ok then
      update public.edge_rate_limit_buckets
      set count = greatest (0, count - 1),
          updated_at = now ()
      where scope = p_scope
        and dim = 'ip'
        and key_hash = v_ip_hash
        and window_start = v_ip_window_start;
    end if;
    return jsonb_build_object ('ok', false, 'error', 'token_hash_required');
  end if;

  if not v_token_ok then
    return jsonb_build_object (
      'ok', false,
      'error', 'rate_limited',
      'retry_after_seconds', v_retry
    );
  end if;

  return jsonb_build_object ('ok', true);
end;
$fn$;

revoke all on function public.edge_rate_limit_consume (
  text, text, text, integer, integer, integer, integer
) from public;
revoke all on function public.edge_rate_limit_consume (
  text, text, text, integer, integer, integer, integer
) from anon;
revoke all on function public.edge_rate_limit_consume (
  text, text, text, integer, integer, integer, integer
) from authenticated;

do $consume_grant$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.edge_rate_limit_consume (
      text, text, text, integer, integer, integer, integer
    ) to service_role;
  end if;
end;
$consume_grant$;

-- Optional pg_cron hourly sweep when extension is available (idempotent).
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (
      select 1 from cron.job where jobname = 'waka-edge-rate-limit-purge'
    ) then
      perform cron.schedule (
        'waka-edge-rate-limit-purge',
        '17 * * * *',
        $job$select public.edge_rate_limit_purge_expired (3600000);$job$
      );
    end if;
  end if;
exception
  when others then
    -- Cron is optional; lazy purge remains authoritative.
    null;
end;
$cron$;
