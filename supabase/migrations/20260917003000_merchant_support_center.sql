-- WAKA POS — Merchant Support Platform, Phase 1: "Notifications & Support" center.
--
-- New, merchant-facing support objects. NOTHING in this migration modifies the
-- financial core: no changes to sales, sale_line_items, sale_payments,
-- inventory_movements, stock_on_hand, shop_day_closes, financial_correction_requests,
-- sale_line_item_corrections, or any financial RPC. The only touchpoint with the
-- financial correction system is an AFTER INSERT / AFTER UPDATE OF status *trigger*
-- on public.financial_correction_requests that writes merchant_notification rows
-- (purely observational — it never writes to any financial table and never changes
-- correction state or workflow behavior).
--
-- The pre-existing public.support_requests table (migration 18) is the INTERNAL
-- operations queue (single body, internal statuses, no merchant read policy, no
-- conversation). It is deliberately NOT overloaded for the merchant Support Center;
-- these new tables are shop-scoped, conversation-based, and merchant-readable under
-- RLS, mirroring the proven user_can_access_shop / is_waka_internal_role patterns.

-- ============================================================
-- Merchant support tickets (conversation-based)
-- ============================================================

create sequence if not exists public.merchant_support_ticket_number_seq;

create table if not exists public.merchant_support_tickets (
  id uuid primary key default gen_random_uuid (),
  -- Human-friendly reference (presented as WAKA-<number>); never a raw UUID.
  ticket_number bigint not null default nextval ('public.merchant_support_ticket_number_seq') unique,
  shop_id uuid not null references public.shops (id) on delete cascade,
  created_by_user_id uuid not null references auth.users (id),
  subject text not null,
  -- SUPPORT categories only. Selecting one grants no access to any shop system.
  category text not null
    check (category in (
      'account', 'pos', 'inventory', 'sales', 'payments', 'customers',
      'staff', 'printing', 'sync_offline', 'technical', 'other'
    )),
  description text not null,
  -- Merchant-facing lifecycle. No hidden internal states.
  status text not null default 'open'
    check (status in ('open', 'under_review', 'waiting_for_merchant', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  last_message_at timestamptz not null default now (),
  resolved_at timestamptz,
  closed_at timestamptz
);

create index if not exists merchant_support_tickets_shop_status_idx
  on public.merchant_support_tickets (shop_id, status);
create index if not exists merchant_support_tickets_shop_updated_idx
  on public.merchant_support_tickets (shop_id, last_message_at desc);

drop trigger if exists trg_merchant_support_tickets_updated on public.merchant_support_tickets;
create trigger trg_merchant_support_tickets_updated
  before update on public.merchant_support_tickets
  for each row execute function public.set_updated_at ();

-- ============================================================
-- Conversation messages — separate from the ticket, relational on purpose.
-- ============================================================

create table if not exists public.merchant_support_messages (
  id uuid primary key default gen_random_uuid (),
  ticket_id uuid not null references public.merchant_support_tickets (id) on delete cascade,
  author_user_id uuid not null references auth.users (id),
  author_kind text not null check (author_kind in ('merchant', 'waka')),
  body text not null,
  -- Persistent merchant-side read state for the "unread reply" indicator.
  read_by_merchant_at timestamptz,
  created_at timestamptz not null default now ()
);

create index if not exists merchant_support_messages_ticket_idx
  on public.merchant_support_messages (ticket_id, created_at);
create index if not exists merchant_support_messages_unread_waka_idx
  on public.merchant_support_messages (ticket_id)
  where author_kind = 'waka' and read_by_merchant_at is null;

-- ============================================================
-- Merchant notifications — server-authoritative, persistent unread state,
-- shop-scoped (user_id null = every member of the shop).
-- ============================================================

create table if not exists public.merchant_notifications (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade, -- null = shop-wide
  type text not null check (type in (
    'financial_issue_received',
    'financial_issue_under_review',
    'financial_issue_resolved',
    'financial_issue_closed',
    'support_request_received',
    'support_under_review',
    'support_waiting_for_you',
    'support_resolved',
    'support_closed',
    'account_security',
    'system_announcement',
    'license_announcement',
    'service_announcement'
  )),
  title text not null,
  message text not null,
  read_at timestamptz,
  related_ticket_id uuid references public.merchant_support_tickets (id) on delete set null,
  related_request_id uuid references public.financial_correction_requests (id) on delete cascade,
  -- Non-authoritative presentation metadata only (e.g. a sale reference label).
  -- Never internal notes, RPC names, SQL, or security material.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  constraint merchant_notifications_single_relation
    check (not (related_ticket_id is not null and related_request_id is not null))
);

create index if not exists merchant_notifications_shop_unread_idx
  on public.merchant_notifications (shop_id, created_at desc)
  where read_at is null;
create index if not exists merchant_notifications_user_idx
  on public.merchant_notifications (user_id);

-- ============================================================
-- RLS — merchant isolation is enforced HERE, not in the UI.
-- ============================================================

alter table public.merchant_support_tickets enable row level security;
alter table public.merchant_support_messages enable row level security;
alter table public.merchant_notifications enable row level security;

-- Tickets: any real member of the shop may read; only the member themselves may
-- open a ticket (as themselves). No merchant UPDATE/DELETE at all — state changes
-- happen only inside the SECURITY DEFINER RPCs below (or by WAKA internally).
create policy merchant_support_tickets_member_read
  on public.merchant_support_tickets for select
  using (public.user_can_access_shop (shop_id));

create policy merchant_support_tickets_member_insert
  on public.merchant_support_tickets for insert
  with check (
    created_by_user_id = auth.uid ()
    and public.user_can_access_shop (shop_id)
  );

-- Internal support staff read/write hook (Phase 2 dashboard); mirrors
-- support_requests' internal role set. Not used by any merchant client.
create policy merchant_support_tickets_internal_read
  on public.merchant_support_tickets for select
  using (public.is_waka_internal_role (array['super_admin', 'support_admin']));

create policy merchant_support_tickets_internal_update
  on public.merchant_support_tickets for update
  using (public.is_waka_internal_role (array['super_admin', 'support_admin']))
  with check (public.is_waka_internal_role (array['super_admin', 'support_admin']));

create policy merchant_support_tickets_internal_insert
  on public.merchant_support_tickets for insert
  with check (public.is_waka_internal_role (array['super_admin', 'support_admin']));

-- Messages: readable with the ticket; merchants may only append their own
-- 'merchant' messages to replyable tickets. WAKA-side inserts are internal-role only.
create policy merchant_support_messages_member_read
  on public.merchant_support_messages for select
  using (
    exists (
      select 1 from public.merchant_support_tickets t
      where t.id = ticket_id
        and public.user_can_access_shop (t.shop_id)
    )
  );

create policy merchant_support_messages_member_insert
  on public.merchant_support_messages for insert
  with check (
    author_kind = 'merchant'
    and author_user_id = auth.uid ()
    and exists (
      select 1 from public.merchant_support_tickets t
      where t.id = ticket_id
        and public.user_can_access_shop (t.shop_id)
        and t.status in ('open', 'under_review', 'waiting_for_merchant')
    )
  );

create policy merchant_support_messages_internal_read
  on public.merchant_support_messages for select
  using (public.is_waka_internal_role (array['super_admin', 'support_admin']));

create policy merchant_support_messages_internal_insert
  on public.merchant_support_messages for insert
  with check (
    author_kind = 'waka'
    and public.is_waka_internal_role (array['super_admin', 'support_admin'])
  );

-- Notifications: addressed to you specifically, or shop-wide and you are a real
-- member of that shop. Mark-read is a column-scoped UPDATE (see GRANT below) so a
-- merchant can never rewrite title/message/type or forge read state for others.
create policy merchant_notifications_member_read
  on public.merchant_notifications for select
  using (
    user_id = auth.uid ()
    or (user_id is null and public.user_can_access_shop (shop_id))
  );

create policy merchant_notifications_member_update_read
  on public.merchant_notifications for update
  using (
    user_id = auth.uid ()
    or (user_id is null and public.user_can_access_shop (shop_id))
  )
  with check (
    user_id = auth.uid ()
    or (user_id is null and public.user_can_access_shop (shop_id))
  );

-- Internal staff may broadcast shop-wide notifications.
create policy merchant_notifications_internal_insert
  on public.merchant_notifications for insert
  with check (public.is_waka_internal_role (array['super_admin', 'support_admin']));

revoke all on public.merchant_support_tickets from public, anon;
revoke all on public.merchant_support_messages from public, anon;
revoke all on public.merchant_notifications from public, anon;

grant select, insert on public.merchant_support_tickets to authenticated;
-- Table-level UPDATE is granted but every UPDATE is still gated by the
-- merchant_support_tickets_internal_update policy (super_admin/support_admin only);
-- merchants have no UPDATE policy and can never modify a ticket row.
grant update on public.merchant_support_tickets to authenticated;
grant select, insert on public.merchant_support_messages to authenticated;
grant select on public.merchant_notifications to authenticated;
-- Column-level grant: authenticated may ONLY touch read_at on notifications.
grant update (read_at) on public.merchant_notifications to authenticated;

-- ============================================================
-- Merchant RPCs
-- ============================================================

-- Open a support ticket. The description becomes the first conversation message.
create or replace function public.shop_create_support_ticket (
  p_shop_id uuid,
  p_subject text,
  p_category text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_subject text;
  v_category text;
  v_body text;
  v_ticket public.merchant_support_tickets%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if p_shop_id is null or not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_subject := nullif (left (trim (coalesce (p_subject, '')), 200), '');
  if v_subject is null then
    return jsonb_build_object ('ok', false, 'error', 'subject_required');
  end if;

  v_category := lower (trim (coalesce (p_category, 'other')));
  if v_category not in (
    'account', 'pos', 'inventory', 'sales', 'payments', 'customers',
    'staff', 'printing', 'sync_offline', 'technical', 'other'
  ) then
    v_category := 'other';
  end if;

  v_body := nullif (trim (coalesce (p_description, '')), '');
  if v_body is null or char_length (v_body) < 3 then
    return jsonb_build_object ('ok', false, 'error', 'description_required');
  end if;

  insert into public.merchant_support_tickets (
    shop_id, created_by_user_id, subject, category, description
  )
  values (p_shop_id, v_uid, v_subject, v_category, left (v_body, 2000))
  returning * into v_ticket;

  insert into public.merchant_support_messages (
    ticket_id, author_user_id, author_kind, body, read_by_merchant_at
  )
  values (v_ticket.id, v_uid, 'merchant', left (v_body, 2000), now ());

  insert into public.merchant_notifications (
    shop_id, type, title, message, related_ticket_id
  )
  values (
    p_shop_id,
    'support_request_received',
    'Support request received',
    'We received your support request ' || 'WAKA-' || lpad (v_ticket.ticket_number::text, 4, '0')
      || ' ("' || v_ticket.subject || '"). Our team will review it and reply here.',
    v_ticket.id
  );

  return jsonb_build_object (
    'ok', true,
    'ticket_id', v_ticket.id,
    'ticket_number', v_ticket.ticket_number
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.shop_create_support_ticket (uuid, text, text, text) from public;
revoke all on function public.shop_create_support_ticket (uuid, text, text, text) from anon;
grant execute on function public.shop_create_support_ticket (uuid, text, text, text) to authenticated;

-- Merchant reply. Only possible while the ticket is replyable; a reply from
-- "waiting_for_merchant" hands it back to WAKA (status -> 'open').
create or replace function public.shop_reply_support_ticket (
  p_ticket_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_body text;
  v_ticket record;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  v_body := nullif (trim (coalesce (p_body, '')), '');
  if v_body is null or char_length (v_body) < 1 then
    return jsonb_build_object ('ok', false, 'error', 'message_required');
  end if;

  select id, shop_id, status into v_ticket
  from public.merchant_support_tickets
  where id = p_ticket_id
  for update;

  if v_ticket.id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  if not public.user_can_access_shop (v_ticket.shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if v_ticket.status not in ('open', 'under_review', 'waiting_for_merchant') then
    return jsonb_build_object ('ok', false, 'error', 'ticket_not_replyable');
  end if;

  insert into public.merchant_support_messages (
    ticket_id, author_user_id, author_kind, body, read_by_merchant_at
  )
  values (p_ticket_id, v_uid, 'merchant', left (v_body, 4000), now ());

  update public.merchant_support_tickets
  set
    status = case when status = 'waiting_for_merchant' then 'open' else status end,
    last_message_at = now (),
    updated_at = now ()
  where id = p_ticket_id;

  return jsonb_build_object ('ok', true, 'ticket_id', p_ticket_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.shop_reply_support_ticket (uuid, text) from public;
revoke all on function public.shop_reply_support_ticket (uuid, text) from anon;
grant execute on function public.shop_reply_support_ticket (uuid, text) to authenticated;

-- Persistent "unread reply" reset: merchant opened the conversation.
create or replace function public.shop_mark_ticket_messages_read (
  p_ticket_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_ticket record;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select id, shop_id into v_ticket
  from public.merchant_support_tickets
  where id = p_ticket_id;

  if v_ticket.id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  if not public.user_can_access_shop (v_ticket.shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  update public.merchant_support_messages
  set read_by_merchant_at = now ()
  where ticket_id = p_ticket_id
    and author_kind = 'waka'
    and read_by_merchant_at is null;

  return jsonb_build_object ('ok', true);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.shop_mark_ticket_messages_read (uuid) from public;
revoke all on function public.shop_mark_ticket_messages_read (uuid) from anon;
grant execute on function public.shop_mark_ticket_messages_read (uuid) to authenticated;

-- Mark one notification read (only if it is addressed to the caller).
create or replace function public.shop_mark_notification_read (
  p_notification_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_n record;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select id into v_n
  from public.merchant_notifications
  where id = p_notification_id
    and (user_id = v_uid or (user_id is null and public.user_can_access_shop (shop_id)));

  if v_n.id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  update public.merchant_notifications
  set read_at = now ()
  where id = p_notification_id
    and read_at is null;

  return jsonb_build_object ('ok', true);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.shop_mark_notification_read (uuid) from public;
revoke all on function public.shop_mark_notification_read (uuid) from anon;
grant execute on function public.shop_mark_notification_read (uuid) to authenticated;

-- Mark every visible notification in the caller's shop read (e.g. "Mark all read").
create or replace function public.shop_mark_all_notifications_read (
  p_shop_id uuid
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

  if p_shop_id is null or not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  update public.merchant_notifications
  set read_at = now ()
  where shop_id = p_shop_id
    and read_at is null
    and (user_id = v_uid or user_id is null);

  return jsonb_build_object ('ok', true);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.shop_mark_all_notifications_read (uuid) from public;
revoke all on function public.shop_mark_all_notifications_read (uuid) from anon;
grant execute on function public.shop_mark_all_notifications_read (uuid) to authenticated;

-- Merchant-friendly view of THEIR OWN financial correction reports. The financial
-- correction system remains authoritative and untouched; this only projects a safe
-- summary (never admin_notes, correction internals, or SQL/RPC details) for the
-- reporter who already owns the row via RLS (reported_by_user_id = auth.uid()).
create or replace function public.shop_list_my_financial_correction_requests (
  p_shop_id uuid
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

  if p_shop_id is null or not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  return jsonb_build_object (
    'ok', true,
    'requests', coalesce (
      (
        select jsonb_agg (
          jsonb_build_object (
            'id', r.id,
            'status', r.status,
            'saleRef', '#' || left (r.sale_id::text, 8),
            'productName', p.name,
            'quantity', sli.quantity,
            'reason', r.reason,
            'createdAt', r.created_at,
            'updatedAt', r.updated_at
          )
          order by r.created_at desc
        )
        from public.financial_correction_requests r
        join public.sale_line_items sli on sli.id = r.sale_line_item_id
        join public.products p on p.id = r.product_id
        where r.shop_id = p_shop_id
          and r.reported_by_user_id = v_uid
      ),
      '[]'::jsonb
    )
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.shop_list_my_financial_correction_requests (uuid) from public;
revoke all on function public.shop_list_my_financial_correction_requests (uuid) from anon;
grant execute on function public.shop_list_my_financial_correction_requests (uuid) to authenticated;

-- ============================================================
-- Financial-correction → merchant notification bridge (observational trigger).
-- Fires when the EXISTING financial workflow inserts a request or moves its status.
-- It never writes financial data; it only appends a merchant_notification so the
-- reporter sees "Financial issue under review / resolved" in the Support Center.
-- ============================================================

create or replace function public.merchant_notify_financial_correction_change ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_ref text := '#' || left (new.sale_id::text, 8);
  v_type text;
  v_title text;
  v_message text;
begin
  -- On UPDATE, only react to an actual status transition.
  if tg_op = 'UPDATE' then
    if old.status is not distinct from new.status then
      return new;
    end if;
  end if;

  case new.status
    when 'submitted' then
      v_type := 'financial_issue_received';
      v_title := 'Financial issue reported';
      v_message := 'We received your report for Sale ' || v_sale_ref || '. Our team will review the financial information associated with this sale.';
    when 'under_review' then
      v_type := 'financial_issue_under_review';
      v_title := 'Financial issue under review';
      v_message := 'Our team is reviewing the financial information associated with Sale ' || v_sale_ref || '.';
    when 'approved' then
      v_type := 'financial_issue_under_review';
      v_title := 'Financial issue under review';
      v_message := 'Your report for Sale ' || v_sale_ref || ' was approved for correction. Our team is completing the review.';
    when 'requires_manual_review' then
      v_type := 'financial_issue_under_review';
      v_title := 'Financial issue under review';
      v_message := 'Your report for Sale ' || v_sale_ref || ' needs a deeper look from our finance team. No action is needed from you.';
    when 'correction_applied' then
      v_type := 'financial_issue_resolved';
      v_title := 'Financial issue resolved';
      v_message := 'Your reported issue for Sale ' || v_sale_ref || ' has been reviewed and resolved.';
    when 'rejected' then
      v_type := 'financial_issue_closed';
      v_title := 'Financial issue closed';
      v_message := 'Your reported issue for Sale ' || v_sale_ref || ' was reviewed. Our records show the sale information is correct, so no correction was applied.';
    else
      return new;
  end case;

  insert into public.merchant_notifications (
    shop_id, type, title, message, related_request_id,
    metadata
  )
  values (
    new.shop_id, v_type, v_title, v_message, new.id,
    jsonb_build_object ('saleRef', v_sale_ref)
  );

  return new;
end;
$$;

drop trigger if exists trg_merchant_notify_financial_correction on public.financial_correction_requests;
create trigger trg_merchant_notify_financial_correction
  after insert or update of status on public.financial_correction_requests
  for each row execute function public.merchant_notify_financial_correction_change ();
