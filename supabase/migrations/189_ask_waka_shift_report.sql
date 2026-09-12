-- Ask WAKA true shift report: read-only aggregation over the existing
-- shop_shifts sync table (public.shop_shifts, from 108_multi_device_operational_sync.sql).
--
-- shop_shifts.payload already holds the client's authoritative ShiftRecord
-- (accumulated incrementally at sale/return/void/close time in usePosStore.ts,
-- synced up via shop_push_shift). This function does NOT recompute financial
-- totals from raw sales rows — sales carry no shift_id column, so any such
-- reconstruction would require guessing shift boundaries. Instead it reads the
-- already-authoritative stored fields on the shift record and performs only
-- the same trivial, already-audited arithmetic the app itself uses:
--   net_sales    = greatest(0, sales - returns - voids)              (mirrors shop_get_daily_sales_summary)
--   expected_cash = counted_cash - cash_difference                    (mirrors computeShiftCloseAmounts in shiftRecoveryOps.ts, where differenceUgx = counted - expected)
--   opening_cash  = segmentBaselineUgx ?? verifiedFloatUgx ?? openingFloatUgx (mirrors shiftBaselineUgx in saleAdjustments.ts)
--
-- Shift selection when p_shift_id is omitted never guesses across concurrent
-- open shifts: exactly one open shift auto-selects; zero open shifts falls
-- back to the most recently closed shift; more than one open shift returns
-- an explicit multiple_open_shifts candidate list instead of picking one.

create or replace function public.shop_get_shift_report (p_shift_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop uuid := public._report_assert_shop ();
  v_row public.shop_shifts%rowtype;
  v_open_count int;
  v_candidates jsonb;
  v_payload jsonb;
  v_counted numeric;
  v_diff numeric;
  v_sales numeric;
  v_returns numeric;
  v_voids numeric;
  v_net numeric;
  v_opening numeric;
  v_expected numeric;
begin
  if p_shift_id is not null then
    select * into v_row from public.shop_shifts where id = p_shift_id and shop_id = v_shop;
    if not found then
      return jsonb_build_object ('ok', false, 'error', 'shift_not_found');
    end if;
  else
    select count(*) into v_open_count
    from public.shop_shifts
    where shop_id = v_shop and end_at is null;

    if v_open_count = 1 then
      select * into v_row
      from public.shop_shifts
      where shop_id = v_shop and end_at is null
      limit 1;
    elsif v_open_count = 0 then
      select * into v_row
      from public.shop_shifts
      where shop_id = v_shop and end_at is not null
      order by end_at desc
      limit 1;
      if not found then
        return jsonb_build_object ('ok', false, 'error', 'no_shift_found');
      end if;
    else
      select coalesce (
        jsonb_agg (
          jsonb_build_object (
            'id', s.id,
            'actor_user_id', s.actor_user_id,
            'actor_name', s.payload ->> 'actorName',
            'start_at', s.start_at
          )
          order by s.start_at desc
        ),
        '[]'::jsonb
      )
      into v_candidates
      from public.shop_shifts s
      where s.shop_id = v_shop and s.end_at is null;

      return jsonb_build_object ('ok', false, 'error', 'multiple_open_shifts', 'candidates', v_candidates);
    end if;
  end if;

  v_payload := coalesce (v_row.payload, '{}'::jsonb);
  v_counted := nullif (v_payload ->> 'countedCashUgx', '')::numeric;
  v_diff := nullif (v_payload ->> 'cashDifferenceUgx', '')::numeric;
  v_sales := coalesce (nullif (v_payload ->> 'salesTotalUgx', '')::numeric, 0);
  v_returns := coalesce (nullif (v_payload ->> 'returnsTotalUgx', '')::numeric, 0);
  v_voids := coalesce (nullif (v_payload ->> 'voidsTotalUgx', '')::numeric, 0);
  v_net := greatest (0, v_sales - v_returns - v_voids);
  v_opening := coalesce (
    nullif (v_payload ->> 'segmentBaselineUgx', '')::numeric,
    nullif (v_payload ->> 'verifiedFloatUgx', '')::numeric,
    nullif (v_payload ->> 'openingFloatUgx', '')::numeric
  );
  v_expected := case when v_counted is not null and v_diff is not null then v_counted - v_diff else null end;

  return jsonb_build_object (
    'ok', true,
    'shift_id', v_row.id,
    'actor_user_id', v_row.actor_user_id,
    'actor_name', v_payload ->> 'actorName',
    'start_at', v_row.start_at,
    'end_at', v_row.end_at,
    'status', case when v_row.end_at is null then 'open' else 'closed' end,
    'sales_total_ugx', v_sales,
    'discounts_ugx', coalesce (nullif (v_payload ->> 'discountsTotalUgx', '')::numeric, 0),
    'returns_ugx', v_returns,
    'voids_ugx', v_voids,
    'net_sales_ugx', v_net,
    'debt_issued_ugx', coalesce (nullif (v_payload ->> 'debtTotalUgx', '')::numeric, 0),
    'debt_payments_collected_ugx', coalesce (nullif (v_payload ->> 'debtPaymentsTotalUgx', '')::numeric, 0),
    'cash_collected_ugx', coalesce (nullif (v_payload ->> 'estimatedCashUgx', '')::numeric, 0),
    'opening_cash_ugx', v_opening,
    'counted_cash_ugx', v_counted,
    'expected_cash_ugx', v_expected,
    'cash_difference_ugx', v_diff,
    'verification_status', v_payload ->> 'verificationStatus',
    'shop_id', v_shop
  );
end;
$$;

revoke all on function public.shop_get_shift_report (uuid) from public;
grant execute on function public.shop_get_shift_report (uuid) to authenticated;
