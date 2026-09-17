-- WAKA POS — Merchant Support Platform, Phase 2.5: "Real-time messaging + attachments + audio".
--
-- New objects only for the Support Center. NOTHING in this migration modifies the
-- financial core: no changes to sales, sale_line_items, sale_payments,
-- inventory_movements, stock_on_hand, shop_day_closes, financial_correction_requests,
-- sale_line_item_corrections, or any financial RPC. The ONLY table from Phase 1 that
-- is altered is public.merchant_support_messages (a new shop_id mirror column for
-- shop-scoped realtime — support-only, never read by financial logic).
--
-- What this migration adds:
--   1. Realtime publication membership for the three Phase 1 support tables.
--   2. merchant_support_attachments — metadata only; binaries live in the new
--      PRIVATE storage bucket "merchant-support-attachments".
--   3. Storage RLS policies: upload only into the caller's own shop's active
--      ticket; download only through an attachment row the caller may see.
--   4. shop_reply_support_ticket(p_attachments) — attachments ride on the
--      existing single messaging RPC; CLOSED/RESOLVED tickets keep rejecting
--      replies and now also reject attachment metadata (server-side).
--   5. Server-side, idempotent attachment cleanup when a ticket is CLOSED
--      (final state of the EXISTING lifecycle — RESOLVED can still transition,
--      so cleanup fires only at CLOSED, matching the existing state machine).

-- ============================================================
-- 1. Realtime: stream the Phase 1 support tables (RLS-filtered per subscriber)
-- ============================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'merchant_support_tickets') then
      alter publication supabase_realtime add table public.merchant_support_tickets;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'merchant_support_messages') then
      alter publication supabase_realtime add table public.merchant_support_messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'merchant_notifications') then
      alter publication supabase_realtime add table public.merchant_notifications;
    end if;
  end if;
end $$;

-- Filters on UPDATE events reference non-PK columns (shop_id / status /
-- read_by_merchant_at), so FULL replica identity is required for the payload.
alter table public.merchant_support_tickets replica identity full;
alter table public.merchant_support_messages replica identity full;
alter table public.merchant_notifications replica identity full;

-- ============================================================
-- 2. Private storage bucket (binaries ONLY — never in PostgreSQL)
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('merchant-support-attachments', 'merchant-support-attachments', false, 20971520) -- 20 MB hard cap
on conflict (id) do nothing;

-- ============================================================
-- 3. Attachment metadata table (tombstone-friendly: deleted_at)
-- ============================================================

create table if not exists public.merchant_support_attachments (
  id uuid primary key default gen_random_uuid (),
  message_id uuid not null references public.merchant_support_messages (id) on delete cascade,
  ticket_id uuid not null references public.merchant_support_tickets (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  attachment_kind text not null check (attachment_kind in ('image', 'document', 'audio', 'other')),
  created_at timestamptz not null default now (),
  deleted_at timestamptz
);

create index if not exists merchant_support_attachments_ticket_idx
  on public.merchant_support_attachments (ticket_id);
create index if not exists merchant_support_attachments_message_idx
  on public.merchant_support_attachments (message_id);
create index if not exists merchant_support_attachments_shop_idx
  on public.merchant_support_attachments (shop_id);
create index if not exists merchant_support_attachments_path_idx
  on public.merchant_support_attachments (storage_path);

-- Shop-scoped realtime mirror on messages. Backfill from the owning ticket, then a
-- BEFORE INSERT trigger keeps it authoritative so neither client nor admin inserts
-- ever have to (or can) forge it.
alter table public.merchant_support_messages
  add column if not exists shop_id uuid references public.shops (id);

update public.merchant_support_messages m
set shop_id = t.shop_id
from public.merchant_support_tickets t
where t.id = m.ticket_id and m.shop_id is null;

alter table public.merchant_support_messages alter column shop_id set not null;

create index if not exists merchant_support_messages_shop_idx
  on public.merchant_support_messages (shop_id);

create or replace function public.merchant_support_message_set_shop ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shop_id is null then
    select shop_id into new.shop_id
    from public.merchant_support_tickets
    where id = new.ticket_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_merchant_support_messages_shop on public.merchant_support_messages;
create trigger trg_merchant_support_messages_shop
  before insert on public.merchant_support_messages
  for each row execute function public.merchant_support_message_set_shop ();

-- ============================================================
-- 4. RLS — merchants read; internal staff read/write; NO merchant DML.
--    Merchant attachment metadata is created only inside the SECURITY DEFINER
--    reply RPC below, after it validates ticket state, ownership, MIME and size.
-- ============================================================

alter table public.merchant_support_attachments enable row level security;

create policy merchant_support_attachments_member_read
  on public.merchant_support_attachments for select
  using (public.user_can_access_shop (shop_id));

create policy merchant_support_attachments_internal_read
  on public.merchant_support_attachments for select
  using (public.is_waka_internal_role (array['super_admin', 'support_admin']));

create policy merchant_support_attachments_internal_insert
  on public.merchant_support_attachments for insert
  with check (public.is_waka_internal_role (array['super_admin', 'support_admin']));

revoke all on public.merchant_support_attachments from public, anon;
grant select on public.merchant_support_attachments to authenticated;

-- ============================================================
-- 5. Storage object policies — path layout (server-enforced):
--      support/{shop_id}/{ticket_id}/{nonce}/{filename}
-- ============================================================

create policy merchant_support_attachments_storage_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'merchant-support-attachments'
    and (
      public.is_waka_internal_role (array['super_admin', 'support_admin'])
      or exists (
        select 1 from public.merchant_support_attachments a
        where a.storage_path = name
          and a.deleted_at is null
          and public.user_can_access_shop (a.shop_id)
      )
    )
  );

-- Merchant upload: only into a ticket of THEIR shop, only while replyable, and the
-- path segments must match the real ticket/shop. Internal staff may upload for any
-- existing ticket (console still hides the composer on closed tickets).
create policy merchant_support_attachments_storage_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'merchant-support-attachments'
    and (storage.foldername (name))[1] = 'support'
    and (
      public.is_waka_internal_role (array['super_admin', 'support_admin'])
      or exists (
        select 1 from public.merchant_support_tickets t
        where t.id = (storage.foldername (name))[3]::uuid
          and t.shop_id = (storage.foldername (name))[2]::uuid
          and public.user_can_access_shop (t.shop_id)
          and t.status in ('open', 'under_review', 'waiting_for_merchant')
      )
    )
  );

-- ============================================================
-- 6. Reply RPC gains attachments; closed/resolved stay locked
-- ============================================================

create or replace function public.shop_reply_support_ticket (
  p_ticket_id uuid,
  p_body text,
  p_attachments jsonb default '[]'::jsonb
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
  v_message_id uuid;
  v_attachment jsonb;
  v_index int;
  v_path text;
  v_filename text;
  v_mime text;
  v_kind text;
  v_size bigint;
  v_expected_prefix text;
  v_max_attachments constant int := 5;
  -- Conservative support-system limits (single place to change later).
  v_max_image_doc constant bigint := 10485760;  -- 10 MB
  v_max_audio constant bigint := 20971520;      -- 20 MB
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
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

  -- CLOSED (and RESOLVED) tickets are immutable from the merchant side:
  -- no replies, no attachments, no audio — enforced HERE, not in the UI.
  if v_ticket.status not in ('open', 'under_review', 'waiting_for_merchant') then
    return jsonb_build_object ('ok', false, 'error', 'ticket_not_replyable');
  end if;

  v_body := nullif (trim (coalesce (p_body, '')), '');
  if (v_body is null or char_length (v_body) < 1)
     and (p_attachments is null or jsonb_typeof (p_attachments) <> 'array' or jsonb_array_length (p_attachments) = 0) then
    return jsonb_build_object ('ok', false, 'error', 'message_required');
  end if;

  if p_attachments is not null and jsonb_typeof (p_attachments) = 'array' then
    if jsonb_array_length (p_attachments) > v_max_attachments then
      return jsonb_build_object ('ok', false, 'error', 'too_many_attachments');
    end if;
  end if;

  insert into public.merchant_support_messages (
    ticket_id, author_user_id, author_kind, body, read_by_merchant_at
  )
  values (p_ticket_id, v_uid, 'merchant', left (coalesce (v_body, ''), 4000), now ())
  returning id into v_message_id;

  -- Expected server-owned prefix; client-supplied paths outside it are rejected.
  v_expected_prefix := 'support/' || v_ticket.shop_id::text || '/' || p_ticket_id::text || '/';

  if p_attachments is not null and jsonb_typeof (p_attachments) = 'array' then
    v_index := 0;
    for v_attachment in select * from jsonb_array_elements (p_attachments) loop
      v_index := v_index + 1;

      v_path := nullif (trim (coalesce (v_attachment ->> 'storage_path', '')), '');
      v_filename := left (nullif (trim (coalesce (v_attachment ->> 'original_filename', 'attachment')), ''), 255);
      v_mime := lower (split_part (nullif (trim (coalesce (v_attachment ->> 'mime_type', '')), ''), ';', 1));
      v_size := nullif ((v_attachment ->> 'file_size_bytes')::bigint, 0);

      if v_path is null
         or v_path <> left (v_path, 700)
         or v_path != replace (v_path, chr (0), '')
         or strpos (v_path, '..') > 0
         or v_path not like v_expected_prefix || '%' then
        raise exception 'invalid_attachment_path';
      end if;

      if v_mime in ('image/jpeg', 'image/png', 'image/webp') then
        v_kind := 'image';
        if v_size is null or v_size > v_max_image_doc then
          raise exception 'invalid_attachment_size';
        end if;
      elsif v_mime = 'application/pdf' then
        v_kind := 'document';
        if v_size is null or v_size > v_max_image_doc then
          raise exception 'invalid_attachment_size';
        end if;
      elsif v_mime in ('audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav') then
        v_kind := 'audio';
        if v_size is null or v_size > v_max_audio then
          raise exception 'invalid_attachment_size';
        end if;
      else
        raise exception 'invalid_attachment_type';
      end if;

      insert into public.merchant_support_attachments (
        message_id, ticket_id, shop_id, storage_path, original_filename,
        mime_type, file_size_bytes, attachment_kind
      )
      values (
        v_message_id, p_ticket_id, v_ticket.shop_id, v_path, v_filename,
        v_mime, v_size, v_kind
      );
    end loop;
  end if;

  update public.merchant_support_tickets
  set
    status = case when status = 'waiting_for_merchant' then 'open' else status end,
    last_message_at = now (),
    updated_at = now ()
  where id = p_ticket_id;

  return jsonb_build_object ('ok', true, 'ticket_id', p_ticket_id, 'message_id', v_message_id);
exception
  when raise_exception then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
  when others then
    return jsonb_build_object ('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.shop_reply_support_ticket (uuid, text, jsonb) from public;
revoke all on function public.shop_reply_support_ticket (uuid, text, jsonb) from anon;
grant execute on function public.shop_reply_support_ticket (uuid, text, jsonb) to authenticated;

-- ============================================================
-- 7. Server-side attachment cleanup (idempotent, final-state only)
-- ============================================================

create or replace function public.support_cleanup_ticket_attachments (p_ticket_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_rec record;
  v_prefix text;
  v_count integer := 0;
begin
  if p_ticket_id is null then
    return 0;
  end if;

  -- 1. Marked metadata: delete the Storage object, then tombstone the row.
  for v_rec in
    select id, storage_path
    from public.merchant_support_attachments
    where ticket_id = p_ticket_id and deleted_at is null
  loop
    delete from storage.objects
    where bucket_id = 'merchant-support-attachments' and name = v_rec.storage_path;

    update public.merchant_support_attachments
    set deleted_at = now ()
    where id = v_rec.id and deleted_at is null;

    v_count := v_count + 1;
  end loop;

  -- 2. Orphans (uploaded but the message RPC never committed — no metadata row):
  --    once the ticket is CLOSED nothing can legitimately be attached, so every
  --    remaining object under its prefix is by definition residue.
  select 'support/' || t.shop_id::text || '/' || t.id::text || '/'
  into v_prefix
  from public.merchant_support_tickets t
  where t.id = p_ticket_id;

  if v_prefix is not null then
    delete from storage.objects
    where bucket_id = 'merchant-support-attachments'
      and name like v_prefix || '%';
  end if;

  return v_count;
end;
$$;

revoke all on function public.support_cleanup_ticket_attachments (uuid) from public;
revoke all on function public.support_cleanup_ticket_attachments (uuid) from anon;
revoke all on function public.support_cleanup_ticket_attachments (uuid) from authenticated;

-- Fire only on the transition INTO the final state (CLOSED). RESOLVED is NOT
-- final in the existing lifecycle (it can still move to closed), so attachments
-- survive until CLOSED — matching the existing state machine exactly.
create or replace function public.merchant_support_ticket_cleanup_on_close ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.status = 'closed'
     and old.status is distinct from 'closed' then
    perform public.support_cleanup_ticket_attachments (new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_merchant_support_ticket_cleanup on public.merchant_support_tickets;
create trigger trg_merchant_support_ticket_cleanup
  after update on public.merchant_support_tickets
  for each row execute function public.merchant_support_ticket_cleanup_on_close ();

-- Manual, internal-only retry hook: idempotent (metadata rows already tombstoned
-- are skipped; Storage deletes of missing objects are no-ops).
create or replace function public.waka_admin_reclean_ticket_attachments (p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid () is null
     or not public.is_waka_internal_role (array['super_admin', 'support_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select public.support_cleanup_ticket_attachments (p_ticket_id) into v_count;

  return jsonb_build_object ('ok', true, 'deleted_count', v_count);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.waka_admin_reclean_ticket_attachments (uuid) from public;
revoke all on function public.waka_admin_reclean_ticket_attachments (uuid) from anon;
grant execute on function public.waka_admin_reclean_ticket_attachments (uuid) to authenticated;
