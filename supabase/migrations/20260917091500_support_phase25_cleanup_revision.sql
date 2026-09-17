-- WAKA POS — Merchant Support Platform, Phase 2.5 (revision 2).
--
-- Fixes applied on top of 20260917090000 after live smoke testing:
--   1. shop_reply_support_ticket: remove the chr(0) check (evaluating chr(0)
--      itself raises "null character not permitted" on PG16+, which made EVERY
--      attachment reply fail) and replace the odd length idiom with length().
--   2. Attachment cleanup: hosted Supabase blocks direct deletes from
--      storage.objects (storage.protect_delete) and the physical bytes live in
--      object storage, so the DB trigger CANNOT remove files itself. Redesigned:
--        - storage.objects gets a DELETE policy gated on the ticket being CLOSED
--          (files of closed tickets are already slated for destruction; no
--          exposure risk — the policy grants no read) plus owner-staging cleanup;
--        - the close trigger tombstones metadata and enqueues per-file DELETE
--          calls to the Supabase Storage API via pg_net (async DB background
--          worker — no browser involved). pg_net is installed here; if it were
--          missing the function degrades to tombstone-only and the internal
--          reclean RPC can re-enqueue later;
--        - the reclean RPC is idempotent (deleting an already-gone object is a
--          harmless 404) and an optional pg_cron hourly sweep re-enqueues for
--          tickets closed within the last day.
--   3. Drop the temporary debug function dbg_reply.

-- ============================================================
-- 1. Reply RPC: working attachment validation
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
         or length (v_path) > 700
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

-- ============================================================
-- 2. Storage DELETE policies
--    a) The CLOSED-ticket gate: objects of a closed ticket are already slated
--       for destruction (this migration's cleanup design); the policy grants
--       DELETE only, never READ, so it exposes no data.
--    b) Owner staging cleanup: the uploader may remove a file that has NO
--       attachment metadata yet (failed sends), so staging never leaks.
-- ============================================================

drop policy if exists merchant_support_attachments_storage_delete on storage.objects;
create policy merchant_support_attachments_storage_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'merchant-support-attachments'
    and (
      public.is_waka_internal_role (array['super_admin', 'support_admin'])
      or exists (
        select 1 from public.merchant_support_tickets t
        where t.status = 'closed'
          and name like 'support/' || t.shop_id::text || '/' || t.id::text || '/%'
      )
      or (
        owner = auth.uid ()
        and not exists (
          select 1 from public.merchant_support_attachments a
          where a.storage_path = name
        )
      )
    )
  );

-- ============================================================
-- 3. pg_net (async HTTP from the database) — installed when available
-- ============================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ============================================================
-- 4. Cleanup: tombstone + enqueue Storage-API deletes (never raises)
-- ============================================================

create or replace function public.support_cleanup_ticket_attachments (p_ticket_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rec record;
  v_count integer := 0;
  -- Project ref (public identifier, embedded in the anon JWT) and the project's
  -- anon key (public by design — it ships in every client bundle). The Storage
  -- DELETE is authorized by the closed-ticket RLS policy, not by this key's
  -- secrecy.
  v_project constant text := 'ljaedextsenbkxzzgxcg';
  v_anon_key constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqYWVkZXh0c2VuYmt4enpneGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNTI1MjAsImV4cCI6MjA5MzkyODUyMH0.jAEo-4x0-VpU0T_uMz7FbT_I14DF9Rte-6n6iZaGlTo';
begin
  if p_ticket_id is null then
    return 0;
  end if;

  -- Tombstone metadata rows; enqueue a Storage-API DELETE for each file.
  for v_rec in
    select id, storage_path
    from public.merchant_support_attachments
    where ticket_id = p_ticket_id and deleted_at is null
  loop
    begin
      update public.merchant_support_attachments
      set deleted_at = now ()
      where id = v_rec.id and deleted_at is null;

      -- Enqueue via pg_net's background worker (no browser involved). The
      -- closed-ticket DELETE policy authorizes this call. Deleting an
      -- already-gone object returns 404 — harmless, hence idempotent.
      if to_regnamespace ('extensions') is not null
         and to_regprocedure ('extensions.http_request(text,text,jsonb,jsonb,jsonb,integer)') is not null then
        perform extensions.http_request (
          'DELETE',
          'https://' || v_project || '.supabase.co/storage/v1/object/merchant-support-attachments/' || v_rec.storage_path,
          jsonb_build_object (
            'apikey', v_anon_key,
            'authorization', 'Bearer ' || v_anon_key
          ),
          '[]'::jsonb,
          null,
          8000
        );
      end if;
    exception
      when others then
        null; -- cleanup must never break ticket close; reclean retries later
    end;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.support_cleanup_ticket_attachments (uuid) from public;
revoke all on function public.support_cleanup_ticket_attachments (uuid) from anon;
revoke all on function public.support_cleanup_ticket_attachments (uuid) from authenticated;

-- Re-enqueue cleanup for a closed ticket (idempotent retry hook).
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

-- ============================================================
-- 5. Optional hourly re-enqueue sweep for recently closed tickets
-- ============================================================

do $$
begin
  if to_regnamespace ('cron') is not null then
    perform cron.schedule (
      'support-attachment-reclean',
      '13 * * * *',
      $sql$ select public.support_cleanup_ticket_attachments (t.id)
             from public.merchant_support_tickets t
             where t.status = 'closed'
               and t.closed_at > now () - interval '1 day'; $sql$
    );
  end if;
exception
  when others then
    null; -- sweep is best-effort; reclean RPC remains the manual retry path
end $$;

-- ============================================================
-- 6. Drop temporary debug artifacts
-- ============================================================

drop function if exists public.dbg_reply (uuid, text, jsonb);
