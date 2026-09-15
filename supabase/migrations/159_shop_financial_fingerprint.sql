-- Cloud-side financial fingerprint (Phase 7 dependency).
--
-- Read-only. Lets a device compare its local corrected-line state against the cloud's
-- during snapshot-restore certification, without needing a full-table content hash —
-- restricted to `financial_revision > 0` rows (the corrected subset, which stays a
-- tiny fraction of a shop's total sales regardless of shop size), so cost is bounded
-- by correction volume, not sale volume.

create or replace function public.shop_get_financial_fingerprint (
  p_shop_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_corrected_line_count int;
  v_revision_sum bigint;
  v_revision_max bigint;
  v_digest text;
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select
    count (*) filter (where sli.financial_revision > 0),
    coalesce (sum (sli.financial_revision) filter (where sli.financial_revision > 0), 0),
    coalesce (max (sli.financial_revision), 0),
    coalesce (
      md5 (
        string_agg (
          sli.id::text || ':' || sli.financial_revision::text, ','
          order by sli.id
        ) filter (where sli.financial_revision > 0)
      ),
      ''
    )
  into v_corrected_line_count, v_revision_sum, v_revision_max, v_digest
  from public.sale_line_items sli
  join public.sales s on s.id = sli.sale_id
  where s.shop_id = p_shop_id and s.status = 'completed';

  return jsonb_build_object (
    'ok', true,
    'correctedLineCount', coalesce (v_corrected_line_count, 0),
    'revisionSum', coalesce (v_revision_sum, 0),
    'revisionMax', coalesce (v_revision_max, 0),
    'correctedLinesDigest', v_digest
  );
end;
$$;

revoke all on function public.shop_get_financial_fingerprint (uuid) from public;
grant execute on function public.shop_get_financial_fingerprint (uuid) to authenticated;
