-- Financial issue reporting workflow: a normal shop user may REPORT a suspected
-- historical financial problem on a completed sale line; they can never invoke the
-- correction RPC, approve their own report, or write to a completed sale's financial
-- fields. Mirrors support_requests' proven shop-scoped RLS pattern (user_can_access_shop
-- for shop users, is_waka_internal_role for internal staff) rather than reusing that
-- table directly — the correction-specific state machine (in particular "only
-- super_admin/finance_admin may ever set correction_applied") needs stricter RLS/RPC
-- gating than a generic support ticket has, so a dedicated table is safer than
-- overloading a live, unrelated workflow.
--
-- No raw UPDATE RLS policy exists on this table at all, for anyone, including internal
-- admins — every state transition goes through one of the two SECURITY DEFINER
-- functions below. This makes "an ordinary user can never move a request into
-- correction_applied" true by construction, not by convention.

create table if not exists public.financial_correction_requests (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  sale_id uuid not null references public.sales (id) on delete cascade,
  sale_line_item_id uuid not null references public.sale_line_items (id) on delete cascade,
  product_id uuid not null references public.products (id),
  reported_by_user_id uuid not null references auth.users (id),
  reason text not null,
  evidence_note text,
  status text not null default 'submitted'
    check (status in (
      'submitted', 'under_review', 'approved', 'rejected',
      'correction_applied', 'requires_manual_review'
    )),
  admin_notes text,
  assigned_internal_admin_id uuid,
  correction_id uuid references public.sale_line_item_corrections (id),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists financial_correction_requests_shop_id_idx
  on public.financial_correction_requests (shop_id);
create index if not exists financial_correction_requests_reporter_idx
  on public.financial_correction_requests (reported_by_user_id);
create index if not exists financial_correction_requests_status_idx
  on public.financial_correction_requests (status);

-- At most one non-terminal (still-open) report per sale line — same "one active per
-- key" shape already proven by sale_line_item_corrections_one_active_per_line and
-- shop_day_closes_one_active_per_shop_date.
create unique index if not exists financial_correction_requests_one_open_per_line
  on public.financial_correction_requests (sale_line_item_id)
  where status not in ('rejected', 'correction_applied');

alter table public.financial_correction_requests enable row level security;

create policy financial_correction_requests_member_insert
  on public.financial_correction_requests for insert
  with check (
    reported_by_user_id = auth.uid()
    and shop_id is not null
    and public.user_can_access_shop (shop_id)
  );

-- "view their own submitted reports" — scoped to the reporter, not shop-wide.
create policy financial_correction_requests_own_read
  on public.financial_correction_requests for select
  using (reported_by_user_id = auth.uid());

create policy financial_correction_requests_internal_read
  on public.financial_correction_requests for select
  using (public.is_waka_internal_role (array['super_admin', 'finance_admin', 'support_admin']));

create policy financial_correction_requests_internal_delete
  on public.financial_correction_requests for delete
  using (public.is_waka_internal_role (array['super_admin', 'support_admin']));

revoke all on public.financial_correction_requests from public, anon;
grant select, insert on public.financial_correction_requests to authenticated;
grant delete on public.financial_correction_requests to authenticated;

-- ============================================================
-- Shop user entry point: report a suspected issue on a completed sale line.
-- Never trusts client-supplied sale_id/product_id — both are re-derived server-side
-- from sale_line_item_id, so a caller cannot fabricate a mismatched linkage. Only
-- requires the caller to already have access to the shop (existing user_can_access_shop
-- — real shop membership), matching what they'd already need to be viewing the sale at
-- all.
create or replace function public.shop_report_financial_issue (
  p_shop_id uuid,
  p_sale_line_item_id uuid,
  p_reason text,
  p_evidence_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_reason text;
  v_line record;
  v_sale record;
  v_request_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if p_shop_id is null or p_sale_line_item_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_arguments');
  end if;

  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_reason := nullif (trim (coalesce (p_reason, '')), '');
  if v_reason is null or char_length (v_reason) < 3 then
    return jsonb_build_object ('ok', false, 'error', 'reason_required');
  end if;

  select id, sale_id, product_id, financial_revision into v_line
  from public.sale_line_items
  where id = p_sale_line_item_id;

  if v_line.id is null then
    return jsonb_build_object ('ok', false, 'error', 'line_not_found');
  end if;

  select id, shop_id, status into v_sale
  from public.sales
  where id = v_line.sale_id;

  if v_sale.id is null or v_sale.shop_id is distinct from p_shop_id then
    return jsonb_build_object ('ok', false, 'error', 'line_not_found');
  end if;

  if v_sale.status <> 'completed' then
    return jsonb_build_object ('ok', false, 'error', 'sale_not_completed');
  end if;

  -- Line already carries a correction (financial_revision > 0) — refuse a new,
  -- unnecessary report rather than creating one, per the reporting workflow's own
  -- "do not allow another unnecessary request" requirement. Does not consult
  -- financial_correction_requests at all here (a line could be corrected via a report
  -- OR via the manual-entry panel) — financial_revision is the one server-authoritative
  -- signal for "has this line ever been corrected," matching what the correction RPC
  -- itself treats as authoritative.
  if coalesce (v_line.financial_revision, 0) > 0 then
    return jsonb_build_object ('ok', false, 'error', 'already_corrected', 'financial_revision', v_line.financial_revision);
  end if;

  begin
    insert into public.financial_correction_requests (
      shop_id, sale_id, sale_line_item_id, product_id, reported_by_user_id, reason, evidence_note
    )
    values (
      p_shop_id, v_sale.id, v_line.id, v_line.product_id, v_uid, left (v_reason, 2000),
      nullif (left (trim (coalesce (p_evidence_note, '')), 2000), '')
    )
    returning id into v_request_id;
  exception
    when unique_violation then
      return jsonb_build_object ('ok', false, 'error', 'report_already_open_for_line');
  end;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id, v_uid, 'shop_user', 'financial_issue_reported',
    'Reported issue on line ' || v_line.id::text,
    jsonb_build_object ('requestId', v_request_id, 'saleId', v_sale.id, 'saleLineItemId', v_line.id, 'reason', v_reason)
  );

  return jsonb_build_object ('ok', true, 'request_id', v_request_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.shop_report_financial_issue (uuid, uuid, text, text) from public;
revoke all on function public.shop_report_financial_issue (uuid, uuid, text, text) from anon;
grant execute on function public.shop_report_financial_issue (uuid, uuid, text, text) to authenticated;

-- ============================================================
-- Internal-admin investigation step. Broader than the correction role gate (matches
-- support_requests' own internal role set: super_admin/finance_admin/support_admin) —
-- but this function CANNOT set correction_applied under any circumstances; that status
-- is reachable only via internal_link_financial_correction_request below.
create or replace function public.internal_set_financial_correction_request_status (
  p_request_id uuid,
  p_status text,
  p_admin_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_status text := lower (trim (coalesce (p_status, '')));
  v_request record;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_waka_internal_role (array['super_admin', 'finance_admin', 'support_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if v_status not in ('under_review', 'approved', 'rejected', 'requires_manual_review') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_status');
  end if;

  select id, status, shop_id into v_request
  from public.financial_correction_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  if v_request.status = 'correction_applied' then
    return jsonb_build_object ('ok', false, 'error', 'already_corrected');
  end if;

  update public.financial_correction_requests
  set
    status = v_status,
    admin_notes = coalesce (nullif (left (trim (p_admin_notes), 2000), ''), admin_notes),
    assigned_internal_admin_id = v_uid,
    updated_at = now ()
  where id = p_request_id;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  select v_request.shop_id, v_uid, ia.role, 'financial_issue_request_status_changed',
    'Request ' || p_request_id::text || ' -> ' || v_status,
    jsonb_build_object ('requestId', p_request_id, 'status', v_status)
  from public.internal_admins ia
  where coalesce (ia.auth_user_id, ia.user_id) = v_uid
  limit 1;

  return jsonb_build_object ('ok', true, 'request_id', p_request_id, 'status', v_status);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.internal_set_financial_correction_request_status (uuid, text, text) from public;
revoke all on function public.internal_set_financial_correction_request_status (uuid, text, text) from anon;
grant execute on function public.internal_set_financial_correction_request_status (uuid, text, text) to authenticated;

-- ============================================================
-- The ONLY path by which a request can reach correction_applied. Called by the admin
-- client immediately after a successful, separate call to the unmodified
-- shop_correct_sale_line_financials — never calls that RPC itself, never writes
-- sale_line_items/sales/sale_line_item_corrections. Gated by the EXACT same role check
-- as shop_correct_sale_line_financials and admin_regenerate_day_close_for_correction
-- (super_admin/finance_admin only) — deliberately narrower than the investigation
-- function above, matching "ordinary internal roles may investigate, only
-- super_admin/finance_admin may apply."
create or replace function public.internal_link_financial_correction_request (
  p_request_id uuid,
  p_correction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_role text;
  v_request record;
  v_correction record;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select ia.role into v_role
  from public.internal_admins ia
  where coalesce (ia.auth_user_id, ia.user_id) = v_uid
    and coalesce (ia.is_active, ia.active, true) = true
    and ia.role = any (array['super_admin', 'finance_admin'])
  limit 1;

  if v_role is null then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select id, sale_line_item_id, status, shop_id into v_request
  from public.financial_correction_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  if v_request.status = 'correction_applied' then
    return jsonb_build_object ('ok', false, 'error', 'already_corrected');
  end if;

  select id, sale_line_item_id into v_correction
  from public.sale_line_item_corrections
  where id = p_correction_id;

  if v_correction.id is null then
    return jsonb_build_object ('ok', false, 'error', 'correction_not_found');
  end if;

  if v_correction.sale_line_item_id is distinct from v_request.sale_line_item_id then
    return jsonb_build_object ('ok', false, 'error', 'correction_line_mismatch');
  end if;

  update public.financial_correction_requests
  set
    status = 'correction_applied',
    correction_id = p_correction_id,
    resolved_by = v_uid,
    resolved_at = now (),
    updated_at = now ()
  where id = p_request_id;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    v_request.shop_id, v_uid, v_role, 'financial_issue_request_linked_to_correction',
    'Request ' || p_request_id::text || ' linked to correction ' || p_correction_id::text,
    jsonb_build_object ('requestId', p_request_id, 'correctionId', p_correction_id, 'saleLineItemId', v_request.sale_line_item_id)
  );

  return jsonb_build_object ('ok', true, 'request_id', p_request_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.internal_link_financial_correction_request (uuid, uuid) from public;
revoke all on function public.internal_link_financial_correction_request (uuid, uuid) from anon;
grant execute on function public.internal_link_financial_correction_request (uuid, uuid) to authenticated;

-- ============================================================
-- Internal admin read helper — the queue view. Same role set as the investigation
-- function; joins in exactly the display fields the admin queue needs so the client
-- never has to separately fetch/join sales/sale_line_items/products itself (and never
-- has to handle a raw sale_line_item_id in the UI).
create or replace function public.internal_list_financial_correction_requests (
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_waka_internal_role (array['super_admin', 'finance_admin', 'support_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  return jsonb_build_object (
    'ok', true,
    'requests', coalesce (
      (
        select jsonb_agg (
          jsonb_build_object (
            'id', r.id,
            'shopId', r.shop_id,
            'shopName', sh.name,
            'saleId', r.sale_id,
            'saleLineItemId', r.sale_line_item_id,
            'productId', r.product_id,
            'productName', p.name,
            'quantity', sli.quantity,
            'saleDate', s.created_at,
            'saleStatus', s.status,
            'currentUnitCostUgx', sli.metadata ->> 'unitCostUgx',
            'currentCogsUgx', sli.metadata ->> 'cogsUgx',
            'currentGrossProfitUgx', sli.metadata ->> 'grossProfitUgx',
            'financialRevision', sli.financial_revision,
            'reason', r.reason,
            'evidenceNote', r.evidence_note,
            'status', r.status,
            'adminNotes', r.admin_notes,
            'reportedByUserId', r.reported_by_user_id,
            'correctionId', r.correction_id,
            'resolvedBy', r.resolved_by,
            'resolvedAt', r.resolved_at,
            'createdAt', r.created_at,
            'updatedAt', r.updated_at
          )
          order by r.created_at desc
        )
        from public.financial_correction_requests r
        join public.sales s on s.id = r.sale_id
        join public.sale_line_items sli on sli.id = r.sale_line_item_id
        join public.products p on p.id = r.product_id
        join public.shops sh on sh.id = r.shop_id
        where p_status is null or r.status = p_status
      ),
      '[]'::jsonb
    )
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.internal_list_financial_correction_requests (text) from public;
revoke all on function public.internal_list_financial_correction_requests (text) from anon;
grant execute on function public.internal_list_financial_correction_requests (text) to authenticated;
