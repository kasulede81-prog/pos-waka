-- Waka POS — App Release Management (Google Play in-app update policy + release notes)
-- Client API exposes ONLY public notes and update settings. Internal notes are admin-only.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.app_releases (
  id uuid primary key default gen_random_uuid (),
  version_number text not null,
  release_name text not null default '',
  release_date date,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  google_play_version_code integer not null check (google_play_version_code > 0),
  minimum_supported_version text not null default '',
  minimum_supported_version_code integer not null default 0 check (minimum_supported_version_code >= 0),
  update_type text not null default 'flexible'
    check (update_type in ('flexible', 'immediate')),
  prompt_users boolean not null default false,
  force_below_minimum boolean not null default false,
  show_whats_new boolean not null default true,
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create unique index if not exists app_releases_version_code_uidx
  on public.app_releases (google_play_version_code);

create index if not exists app_releases_status_version_idx
  on public.app_releases (status, google_play_version_code desc);

create table if not exists public.release_public_notes (
  id uuid primary key default gen_random_uuid (),
  release_id uuid not null unique references public.app_releases (id) on delete cascade,
  content_html text not null default '',
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table if not exists public.release_internal_notes (
  id uuid primary key default gen_random_uuid (),
  release_id uuid not null unique references public.app_releases (id) on delete cascade,
  content_html text not null default '',
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table if not exists public.app_release_events (
  id uuid primary key default gen_random_uuid (),
  release_id uuid references public.app_releases (id) on delete set null,
  event_type text not null,
  device_id text,
  app_version text,
  version_code integer,
  actor_user_id uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now ()
);

create index if not exists app_release_events_release_idx
  on public.app_release_events (release_id, created_at desc);

create index if not exists app_release_events_type_idx
  on public.app_release_events (event_type, created_at desc);

-- updated_at triggers
drop trigger if exists app_releases_updated_at on public.app_releases;
create trigger app_releases_updated_at
  before update on public.app_releases
  for each row execute function public.set_updated_at ();

drop trigger if exists release_public_notes_updated_at on public.release_public_notes;
create trigger release_public_notes_updated_at
  before update on public.release_public_notes
  for each row execute function public.set_updated_at ();

drop trigger if exists release_internal_notes_updated_at on public.release_internal_notes;
create trigger release_internal_notes_updated_at
  before update on public.release_internal_notes
  for each row execute function public.set_updated_at ();

alter table public.app_releases enable row level security;
alter table public.release_public_notes enable row level security;
alter table public.release_internal_notes enable row level security;
alter table public.app_release_events enable row level security;

-- Staff-only direct table access (client uses SECURITY DEFINER RPCs)
drop policy if exists app_releases_staff_all on public.app_releases;
create policy app_releases_staff_all on public.app_releases
  for all using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

drop policy if exists release_public_notes_staff_all on public.release_public_notes;
create policy release_public_notes_staff_all on public.release_public_notes
  for all using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

drop policy if exists release_internal_notes_staff_all on public.release_internal_notes;
create policy release_internal_notes_staff_all on public.release_internal_notes
  for all using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

drop policy if exists app_release_events_staff_read on public.app_release_events;
create policy app_release_events_staff_read on public.app_release_events
  for select using (public.is_waka_internal_staff ());

grant select on public.app_releases to authenticated;
grant select on public.release_public_notes to authenticated;
grant select on public.release_internal_notes to authenticated;
grant select on public.app_release_events to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public._release_require_ops_admin ()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    raise exception 'forbidden';
  end if;
end;
$$;

create or replace function public._release_audit (
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.internal_ops_admin_audit (actor, action, payload)
  values (
    auth.uid (),
    p_action,
    coalesce (p_payload, '{}'::jsonb) || jsonb_build_object ('at', now ())
  );
end;
$$;

create or replace function public._release_row_to_json (p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  v_pub text := '';
  v_int text := '';
  v_published_by_name text := '';
begin
  select r.* into v_row from public.app_releases r where r.id = p_id;
  if not found then
    return null;
  end if;

  select coalesce(pn.content_html, '') into v_pub
  from public.release_public_notes pn where pn.release_id = p_id;

  select coalesce(inn.content_html, '') into v_int
  from public.release_internal_notes inn where inn.release_id = p_id;

  if v_row.published_by is not null then
    select coalesce(ia.full_name, ia.email, '') into v_published_by_name
    from public.internal_admins ia where ia.auth_user_id = v_row.published_by limit 1;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'version_number', v_row.version_number,
    'release_name', v_row.release_name,
    'release_date', v_row.release_date,
    'status', v_row.status,
    'google_play_version_code', v_row.google_play_version_code,
    'minimum_supported_version', v_row.minimum_supported_version,
    'minimum_supported_version_code', v_row.minimum_supported_version_code,
    'update_type', v_row.update_type,
    'prompt_users', v_row.prompt_users,
    'force_below_minimum', v_row.force_below_minimum,
    'show_whats_new', v_row.show_whats_new,
    'published_at', v_row.published_at,
    'published_by', v_row.published_by,
    'published_by_name', v_published_by_name,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at,
    'public_notes_html', v_pub,
    'internal_notes_html', v_int
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Client-safe policy (NO internal notes)
-- ---------------------------------------------------------------------------

create or replace function public.get_app_release_client_policy ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  v_pub text := '';
begin
  select r.* into v_row
  from public.app_releases r
  where r.status = 'published'
  order by r.google_play_version_code desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'policy', null);
  end if;

  select coalesce(pn.content_html, '') into v_pub
  from public.release_public_notes pn
  where pn.release_id = v_row.id;

  return jsonb_build_object(
    'ok', true,
    'policy', jsonb_build_object(
      'release_id', v_row.id,
      'version_number', v_row.version_number,
      'release_name', v_row.release_name,
      'google_play_version_code', v_row.google_play_version_code,
      'minimum_supported_version', v_row.minimum_supported_version,
      'minimum_supported_version_code', v_row.minimum_supported_version_code,
      'update_type', v_row.update_type,
      'prompt_users', v_row.prompt_users,
      'force_below_minimum', v_row.force_below_minimum,
      'show_whats_new', v_row.show_whats_new,
      'public_notes_html', v_pub
    )
  );
end;
$$;

revoke all on function public.get_app_release_client_policy () from public;
grant execute on function public.get_app_release_client_policy () to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Client event logging
-- ---------------------------------------------------------------------------

create or replace function public.log_app_release_client_event (
  p_event_type text,
  p_release_id uuid default null,
  p_device_id text default null,
  p_app_version text default null,
  p_version_code integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed text[] := array[
    'prompt_shown', 'user_skipped', 'download_started', 'download_completed',
    'restart_requested', 'immediate_started', 'immediate_completed', 'error'
  ];
begin
  if p_event_type is null or not (p_event_type = any (v_allowed)) then
    return jsonb_build_object('ok', false, 'error', 'invalid_event_type');
  end if;

  insert into public.app_release_events (
    release_id, event_type, device_id, app_version, version_code, actor_user_id, metadata
  )
  values (
    p_release_id,
    p_event_type,
    nullif(trim(coalesce(p_device_id, '')), ''),
    nullif(trim(coalesce(p_app_version, '')), ''),
    p_version_code,
    auth.uid (),
    coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.log_app_release_client_event (text, uuid, text, text, integer, jsonb) from public;
grant execute on function public.log_app_release_client_event (text, uuid, text, text, integer, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_app_releases ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  perform public._release_require_ops_admin ();

  select coalesce(jsonb_agg(row_to_json(t) order by t.google_play_version_code desc), '[]'::jsonb)
  into v_rows
  from (
    select
      r.id,
      r.version_number,
      r.release_name,
      r.release_date,
      r.status,
      r.google_play_version_code,
      r.minimum_supported_version,
      r.minimum_supported_version_code,
      r.update_type,
      r.prompt_users,
      r.force_below_minimum,
      r.show_whats_new,
      r.published_at,
      r.published_by,
      coalesce(ia.full_name, ia.email, '') as published_by_name,
      r.created_at,
      r.updated_at
    from public.app_releases r
    left join public.internal_admins ia on ia.auth_user_id = r.published_by
  ) t;

  return jsonb_build_object('ok', true, 'releases', v_rows);
end;
$$;

create or replace function public.admin_get_app_release (p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._release_require_ops_admin ();
  return jsonb_build_object('ok', true, 'release', public._release_row_to_json(p_id));
end;
$$;

create or replace function public.admin_save_app_release (
  p_id uuid default null,
  p_version_number text default null,
  p_release_name text default '',
  p_release_date date default null,
  p_google_play_version_code integer default null,
  p_minimum_supported_version text default '',
  p_minimum_supported_version_code integer default 0,
  p_update_type text default 'flexible',
  p_prompt_users boolean default false,
  p_force_below_minimum boolean default false,
  p_show_whats_new boolean default true,
  p_public_notes_html text default '',
  p_internal_notes_html text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_status text;
begin
  perform public._release_require_ops_admin ();

  if p_version_number is null or trim(p_version_number) = '' then
    return jsonb_build_object('ok', false, 'error', 'version_number_required');
  end if;
  if p_google_play_version_code is null or p_google_play_version_code <= 0 then
    return jsonb_build_object('ok', false, 'error', 'google_play_version_code_required');
  end if;
  if p_update_type not in ('flexible', 'immediate') then
    return jsonb_build_object('ok', false, 'error', 'invalid_update_type');
  end if;

  if p_id is null then
    insert into public.app_releases (
      version_number, release_name, release_date, status,
      google_play_version_code, minimum_supported_version, minimum_supported_version_code,
      update_type, prompt_users, force_below_minimum, show_whats_new,
      created_by, updated_by
    )
    values (
      trim(p_version_number),
      coalesce(p_release_name, ''),
      p_release_date,
      'draft',
      p_google_play_version_code,
      coalesce(p_minimum_supported_version, ''),
      coalesce(p_minimum_supported_version_code, 0),
      p_update_type,
      coalesce(p_prompt_users, false),
      coalesce(p_force_below_minimum, false),
      coalesce(p_show_whats_new, true),
      auth.uid (),
      auth.uid ()
    )
    returning id into v_id;

    insert into public.release_public_notes (release_id, content_html) values (v_id, coalesce(p_public_notes_html, ''));
    insert into public.release_internal_notes (release_id, content_html) values (v_id, coalesce(p_internal_notes_html, ''));
  else
    select status into v_status from public.app_releases where id = p_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if v_status = 'archived' then
      return jsonb_build_object('ok', false, 'error', 'archived_read_only');
    end if;

    update public.app_releases
    set
      version_number = trim(p_version_number),
      release_name = coalesce(p_release_name, ''),
      release_date = p_release_date,
      google_play_version_code = p_google_play_version_code,
      minimum_supported_version = coalesce(p_minimum_supported_version, ''),
      minimum_supported_version_code = coalesce(p_minimum_supported_version_code, 0),
      update_type = p_update_type,
      prompt_users = coalesce(p_prompt_users, false),
      force_below_minimum = coalesce(p_force_below_minimum, false),
      show_whats_new = coalesce(p_show_whats_new, true),
      updated_by = auth.uid ()
    where id = p_id;

    update public.release_public_notes
    set content_html = coalesce(p_public_notes_html, '')
    where release_id = p_id;

    update public.release_internal_notes
    set content_html = coalesce(p_internal_notes_html, '')
    where release_id = p_id;

    v_id := p_id;
  end if;

  perform public._release_audit('app_release_saved', jsonb_build_object('release_id', v_id));

  return jsonb_build_object('ok', true, 'release', public._release_row_to_json(v_id));
end;
$$;

create or replace function public.admin_publish_app_release (p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform public._release_require_ops_admin ();

  select status into v_status from public.app_releases where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.app_releases
  set status = 'archived', updated_by = auth.uid ()
  where status = 'published' and id <> p_id;

  update public.app_releases
  set
    status = 'published',
    published_at = now (),
    published_by = auth.uid (),
    updated_by = auth.uid ()
  where id = p_id;

  perform public._release_audit('app_release_published', jsonb_build_object('release_id', p_id));

  insert into public.app_release_events (release_id, event_type, actor_user_id, metadata)
  values (p_id, 'release_published', auth.uid (), jsonb_build_object('source', 'admin'));

  return jsonb_build_object('ok', true, 'release', public._release_row_to_json(p_id));
end;
$$;

create or replace function public.admin_archive_app_release (p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._release_require_ops_admin ();

  update public.app_releases
  set status = 'archived', updated_by = auth.uid ()
  where id = p_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform public._release_audit('app_release_archived', jsonb_build_object('release_id', p_id));

  insert into public.app_release_events (release_id, event_type, actor_user_id, metadata)
  values (p_id, 'release_archived', auth.uid (), jsonb_build_object('source', 'admin'));

  return jsonb_build_object('ok', true, 'release', public._release_row_to_json(p_id));
end;
$$;

create or replace function public.admin_duplicate_app_release (p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src record;
  v_pub text;
  v_int text;
  v_new_id uuid;
  v_new_code integer;
begin
  perform public._release_require_ops_admin ();

  select * into v_src from public.app_releases where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(content_html, '') into v_pub from public.release_public_notes where release_id = p_id;
  select coalesce(content_html, '') into v_int from public.release_internal_notes where release_id = p_id;

  v_new_code := v_src.google_play_version_code + 1;
  while exists (select 1 from public.app_releases where google_play_version_code = v_new_code) loop
    v_new_code := v_new_code + 1;
  end loop;

  insert into public.app_releases (
    version_number, release_name, release_date, status,
    google_play_version_code, minimum_supported_version, minimum_supported_version_code,
    update_type, prompt_users, force_below_minimum, show_whats_new,
    created_by, updated_by
  )
  values (
    v_src.version_number || '-copy',
    v_src.release_name,
    v_src.release_date,
    'draft',
    v_new_code,
    v_src.minimum_supported_version,
    v_src.minimum_supported_version_code,
    v_src.update_type,
    v_src.prompt_users,
    v_src.force_below_minimum,
    v_src.show_whats_new,
    auth.uid (),
    auth.uid ()
  )
  returning id into v_new_id;

  insert into public.release_public_notes (release_id, content_html) values (v_new_id, v_pub);
  insert into public.release_internal_notes (release_id, content_html) values (v_new_id, v_int);

  perform public._release_audit('app_release_duplicated', jsonb_build_object('source_id', p_id, 'new_id', v_new_id));

  return jsonb_build_object('ok', true, 'release', public._release_row_to_json(v_new_id));
end;
$$;

create or replace function public.admin_delete_app_release (p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform public._release_require_ops_admin ();

  select status into v_status from public.app_releases where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_status = 'published' then
    return jsonb_build_object('ok', false, 'error', 'cannot_delete_published');
  end if;

  delete from public.app_releases where id = p_id;

  perform public._release_audit('app_release_deleted', jsonb_build_object('release_id', p_id));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_list_app_release_events (p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  perform public._release_require_ops_admin ();

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_rows
  from (
    select
      e.id,
      e.release_id,
      e.event_type,
      e.device_id,
      e.app_version,
      e.version_code,
      e.metadata,
      e.created_at
    from public.app_release_events e
    order by e.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) t;

  return jsonb_build_object('ok', true, 'events', v_rows);
end;
$$;

revoke all on function public.admin_list_app_releases () from public;
revoke all on function public.admin_get_app_release (uuid) from public;
revoke all on function public.admin_save_app_release (
  uuid, text, text, date, integer, text, integer, text, boolean, boolean, boolean, text, text
) from public;
revoke all on function public.admin_publish_app_release (uuid) from public;
revoke all on function public.admin_archive_app_release (uuid) from public;
revoke all on function public.admin_duplicate_app_release (uuid) from public;
revoke all on function public.admin_delete_app_release (uuid) from public;
revoke all on function public.admin_list_app_release_events (integer) from public;

grant execute on function public.admin_list_app_releases () to authenticated;
grant execute on function public.admin_get_app_release (uuid) to authenticated;
grant execute on function public.admin_save_app_release (
  uuid, text, text, date, integer, text, integer, text, boolean, boolean, boolean, text, text
) to authenticated;
grant execute on function public.admin_publish_app_release (uuid) to authenticated;
grant execute on function public.admin_archive_app_release (uuid) to authenticated;
grant execute on function public.admin_duplicate_app_release (uuid) to authenticated;
grant execute on function public.admin_delete_app_release (uuid) to authenticated;
grant execute on function public.admin_list_app_release_events (integer) to authenticated;
