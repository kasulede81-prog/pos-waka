-- Compatibility patch for older deployed databases missing newer profile columns
-- referenced by onboarding/bootstrap RPCs.

alter table public.profiles
  add column if not exists business_name text;

alter table public.profiles
  add column if not exists email text;

alter table public.profiles
  add column if not exists role text;
