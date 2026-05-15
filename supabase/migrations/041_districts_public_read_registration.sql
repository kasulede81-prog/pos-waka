-- Allow anonymous clients to read Uganda district reference rows (needed before sign-up /
-- OAuth completes). Rows remain read-only reference data — no anon insert/update/delete.

alter table public.districts enable row level security;

drop policy if exists districts_authenticated_read on public.districts;
drop policy if exists districts_public_read on public.districts;

create policy districts_public_read
  on public.districts for select
  to anon, authenticated
  using (true);
