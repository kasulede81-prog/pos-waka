-- Waka POS — user profiles (1:1 with auth.users), Uganda / UGX defaults

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone_e164 text,
  business_name text,
  avatar_url text,
  default_currency text not null default 'UGX',
  locale text default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_e164_format check (
    phone_e164 is null
    or phone_e164 ~ '^\+256[0-9]{9}$'
  )
);

create index if not exists profiles_phone_e164_idx on public.profiles (phone_e164) where phone_e164 is not null;

create or replace function public.set_updated_at ()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at ();

comment on table public.profiles is 'App-level profile; extends auth.users with display + Uganda contact fields.';
