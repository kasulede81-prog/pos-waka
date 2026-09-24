-- Waka POS — Loyalty card designs (B2)
--
-- Merchant-controlled presentation for the public loyalty card.
-- One optional row per shop. Absent row => product (B1) defaults.
--
-- Writes: SECURITY DEFINER RPCs only (mirror loyalty_update_program).
-- Public read: Edge service role after public_card_token → account → shop.

create table if not exists public.loyalty_card_designs (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  program_display_name text null,
  logo_url text null,
  primary_color text null,
  accent_color text null,
  background_color text null,
  text_color text null,
  welcome_message text null,
  card_style text not null default 'classic',
  reward_layout text not null default 'list',
  design_version integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint loyalty_card_designs_program_name_len
    check (program_display_name is null or char_length(program_display_name) <= 60),
  constraint loyalty_card_designs_welcome_len
    check (welcome_message is null or char_length(welcome_message) <= 120),
  constraint loyalty_card_designs_logo_url_len
    check (logo_url is null or char_length(logo_url) <= 2048),
  constraint loyalty_card_designs_primary_hex
    check (primary_color is null or primary_color ~ '^#[0-9a-f]{6}$'),
  constraint loyalty_card_designs_accent_hex
    check (accent_color is null or accent_color ~ '^#[0-9a-f]{6}$'),
  constraint loyalty_card_designs_background_hex
    check (background_color is null or background_color ~ '^#[0-9a-f]{6}$'),
  constraint loyalty_card_designs_text_hex
    check (text_color is null or text_color ~ '^#[0-9a-f]{6}$'),
  constraint loyalty_card_designs_card_style_check
    check (card_style in ('classic', 'modern', 'minimal', 'premium')),
  constraint loyalty_card_designs_reward_layout_check
    check (reward_layout in ('list', 'cards')),
  constraint loyalty_card_designs_version_positive
    check (design_version > 0)
);

drop trigger if exists trg_loyalty_card_designs_updated on public.loyalty_card_designs;
create trigger trg_loyalty_card_designs_updated
  before update on public.loyalty_card_designs
  for each row execute function public.set_updated_at ();

alter table public.loyalty_card_designs enable row level security;

-- Merchant designers may read their shop's row (editor load). Public customers
-- never use PostgREST — Edge reads via service_role after token resolution.
drop policy if exists loyalty_card_designs_select on public.loyalty_card_designs;
create policy loyalty_card_designs_select
  on public.loyalty_card_designs for select
  using (public.user_can_manage_shop (shop_id));

-- No INSERT/UPDATE/DELETE policies for authenticated — writes only via RPCs below.

revoke all on public.loyalty_card_designs from public;
revoke all on public.loyalty_card_designs from anon;
revoke all on public.loyalty_card_designs from authenticated;
grant select on public.loyalty_card_designs to authenticated;

-- ---------- Helpers (validate + normalize) ----------
create or replace function public.loyalty_card_design_normalize_hex (p_color text)
returns text
language plpgsql
immutable
as $fn$
declare
  v text;
begin
  if p_color is null then
    return null;
  end if;
  v := lower(btrim(p_color));
  if v = '' then
    return null;
  end if;
  if v !~ '^#[0-9a-f]{6}$' then
    raise exception 'invalid_color' using errcode = 'P0001';
  end if;
  return v;
end;
$fn$;

create or replace function public.loyalty_card_design_normalize_logo_url (p_url text)
returns text
language plpgsql
immutable
as $fn$
declare
  v text;
  v_lower text;
begin
  if p_url is null then
    return null;
  end if;
  v := btrim(p_url);
  if v = '' then
    return null;
  end if;
  if char_length(v) > 2048 then
    raise exception 'invalid_logo_url' using errcode = 'P0001';
  end if;
  v_lower := lower(v);
  if v_lower !~ '^https://' then
    raise exception 'invalid_logo_url' using errcode = 'P0001';
  end if;
  -- Reject credentials in URL (userinfo) and SVG.
  if position('@' in split_part(substr(v, 9), '/', 1)) > 0 then
    raise exception 'invalid_logo_url' using errcode = 'P0001';
  end if;
  if v_lower ~ '\.svg($|\?)' then
    raise exception 'invalid_logo_url' using errcode = 'P0001';
  end if;
  if v_lower like 'javascript:%' or v_lower like 'data:%' or v_lower like 'file:%' then
    raise exception 'invalid_logo_url' using errcode = 'P0001';
  end if;
  return v;
end;
$fn$;

-- ---------- Upsert ----------
create or replace function public.loyalty_upsert_card_design (
  p_shop_id uuid,
  p_program_display_name text default null,
  p_logo_url text default null,
  p_primary_color text default null,
  p_accent_color text default null,
  p_background_color text default null,
  p_text_color text default null,
  p_welcome_message text default null,
  p_card_style text default 'classic',
  p_reward_layout text default 'list'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_name text;
  v_welcome text;
  v_logo text;
  v_primary text;
  v_accent text;
  v_bg text;
  v_text text;
  v_style text;
  v_layout text;
  v_row public.loyalty_card_designs%rowtype;
begin
  if p_shop_id is null then
    return jsonb_build_object('ok', false, 'error', 'shop_required');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_name := nullif(btrim(coalesce(p_program_display_name, '')), '');
  if v_name is not null and char_length(v_name) > 60 then
    return jsonb_build_object('ok', false, 'error', 'invalid_program_name');
  end if;

  v_welcome := nullif(btrim(coalesce(p_welcome_message, '')), '');
  if v_welcome is not null and char_length(v_welcome) > 120 then
    return jsonb_build_object('ok', false, 'error', 'invalid_welcome_message');
  end if;

  begin
    v_logo := public.loyalty_card_design_normalize_logo_url(p_logo_url);
    v_primary := public.loyalty_card_design_normalize_hex(p_primary_color);
    v_accent := public.loyalty_card_design_normalize_hex(p_accent_color);
    v_bg := public.loyalty_card_design_normalize_hex(p_background_color);
    v_text := public.loyalty_card_design_normalize_hex(p_text_color);
  exception
    when raise_exception then
      if SQLERRM = 'invalid_logo_url' then
        return jsonb_build_object('ok', false, 'error', 'invalid_logo_url');
      end if;
      return jsonb_build_object('ok', false, 'error', 'invalid_color');
  end;

  v_style := lower(btrim(coalesce(p_card_style, 'classic')));
  if v_style not in ('classic', 'modern', 'minimal', 'premium') then
    return jsonb_build_object('ok', false, 'error', 'invalid_card_style');
  end if;

  v_layout := lower(btrim(coalesce(p_reward_layout, 'list')));
  if v_layout not in ('list', 'cards') then
    return jsonb_build_object('ok', false, 'error', 'invalid_reward_layout');
  end if;

  insert into public.loyalty_card_designs (
    shop_id,
    program_display_name,
    logo_url,
    primary_color,
    accent_color,
    background_color,
    text_color,
    welcome_message,
    card_style,
    reward_layout,
    design_version
  )
  values (
    p_shop_id,
    v_name,
    v_logo,
    v_primary,
    v_accent,
    v_bg,
    v_text,
    v_welcome,
    v_style,
    v_layout,
    1
  )
  on conflict (shop_id) do update
  set
    program_display_name = excluded.program_display_name,
    logo_url = excluded.logo_url,
    primary_color = excluded.primary_color,
    accent_color = excluded.accent_color,
    background_color = excluded.background_color,
    text_color = excluded.text_color,
    welcome_message = excluded.welcome_message,
    card_style = excluded.card_style,
    reward_layout = excluded.reward_layout,
    design_version = public.loyalty_card_designs.design_version,
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'design', jsonb_build_object(
      'program_display_name', v_row.program_display_name,
      'logo_url', v_row.logo_url,
      'primary_color', v_row.primary_color,
      'accent_color', v_row.accent_color,
      'background_color', v_row.background_color,
      'text_color', v_row.text_color,
      'welcome_message', v_row.welcome_message,
      'card_style', v_row.card_style,
      'reward_layout', v_row.reward_layout
    )
  );
end;
$function$;

-- ---------- Reset (delete row → B1 defaults) ----------
create or replace function public.loyalty_reset_card_design (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
begin
  if p_shop_id is null then
    return jsonb_build_object('ok', false, 'error', 'shop_required');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  delete from public.loyalty_card_designs where shop_id = p_shop_id;

  return jsonb_build_object('ok', true, 'reset', true);
end;
$function$;

revoke all on function public.loyalty_upsert_card_design (
  uuid, text, text, text, text, text, text, text, text, text
) from public;
revoke all on function public.loyalty_upsert_card_design (
  uuid, text, text, text, text, text, text, text, text, text
) from anon;
revoke all on function public.loyalty_reset_card_design (uuid) from public;
revoke all on function public.loyalty_reset_card_design (uuid) from anon;

grant execute on function public.loyalty_upsert_card_design (
  uuid, text, text, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.loyalty_reset_card_design (uuid) to authenticated;

comment on table public.loyalty_card_designs is
  'B2 merchant loyalty card presentation. Absent row = product defaults. Writes via loyalty_upsert_card_design / loyalty_reset_card_design.';
