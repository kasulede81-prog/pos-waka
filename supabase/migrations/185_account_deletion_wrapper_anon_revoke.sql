-- Remove leftover anon EXECUTE on account-deletion wrappers.
--
-- Live proacl after 184 (PUBLIC already revoked) still has anon=X from
-- Supabase default privileges at CREATE. Migrations 051/110/111/112/148
-- only REVOKE FROM public + GRANT TO authenticated — never FROM anon.
--
-- Authenticated / edge userClient RPCs keep EXECUTE. service_role untouched.
-- Function bodies unchanged.
--
-- Idempotent: skips missing overloads. Safe to re-run.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

do $$
begin
  if to_regprocedure('public.owner_permanently_delete_own_account(text,text)') is not null then
    execute 'revoke all on function public.owner_permanently_delete_own_account (text, text) from public';
    execute 'revoke all on function public.owner_permanently_delete_own_account (text, text) from anon';
    execute 'grant execute on function public.owner_permanently_delete_own_account (text, text) to authenticated';
  end if;

  if to_regprocedure('public.owner_permanently_delete_own_account(text)') is not null then
    execute 'revoke all on function public.owner_permanently_delete_own_account (text) from public';
    execute 'revoke all on function public.owner_permanently_delete_own_account (text) from anon';
    execute 'grant execute on function public.owner_permanently_delete_own_account (text) to authenticated';
  end if;

  if to_regprocedure('public.admin_permanently_delete_shop_account(uuid,text,text)') is not null then
    execute 'revoke all on function public.admin_permanently_delete_shop_account (uuid, text, text) from public';
    execute 'revoke all on function public.admin_permanently_delete_shop_account (uuid, text, text) from anon';
    execute 'grant execute on function public.admin_permanently_delete_shop_account (uuid, text, text) to authenticated';
  end if;

  if to_regprocedure('public.admin_permanently_delete_shop_account(uuid,text)') is not null then
    execute 'revoke all on function public.admin_permanently_delete_shop_account (uuid, text) from public';
    execute 'revoke all on function public.admin_permanently_delete_shop_account (uuid, text) from anon';
    execute 'grant execute on function public.admin_permanently_delete_shop_account (uuid, text) to authenticated';
  end if;
end
$$;
