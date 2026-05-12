-- Compatibility patch for older shops schema used by onboarding save RPC.

alter table public.shops
  add column if not exists district_id uuid;

alter table public.shops
  add column if not exists district text;

alter table public.shops
  add column if not exists city text;

alter table public.shops
  add column if not exists area text;

alter table public.shops
  add column if not exists phone_e164 text;

alter table public.shops
  add column if not exists address_line text;

alter table public.shops
  add column if not exists latitude double precision;

alter table public.shops
  add column if not exists longitude double precision;

alter table public.shops
  add column if not exists gps_missing boolean not null default true;

update public.shops
set gps_missing = (latitude is null or longitude is null)
where gps_missing is distinct from (latitude is null or longitude is null);
