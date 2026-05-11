-- Harden auth.users trigger to never block signup on non-critical profile sync.
-- Also backfill role constraints for older schema states.

alter table public.shop_members
  drop constraint if exists shop_members_role_check;

alter table public.shop_members
  add constraint shop_members_role_check
    check (role in ('owner', 'manager', 'cashier', 'stock_keeper', 'viewer'));

create or replace function public.handle_new_user ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.profiles (id, full_name, business_name, phone_e164)
    values (
      new.id,
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'business_name'), ''),
      case
        when (new.raw_user_meta_data ->> 'phone_e164') ~ '^\+256[0-9]{9}$'
          then trim(new.raw_user_meta_data ->> 'phone_e164')
        else null
      end
    )
    on conflict (id) do update
      set full_name = coalesce(excluded.full_name, public.profiles.full_name),
          business_name = coalesce(excluded.business_name, public.profiles.business_name),
          phone_e164 = coalesce(excluded.phone_e164, public.profiles.phone_e164),
          updated_at = now();
  exception
    when others then
      -- Signup must not fail because profile mirror failed.
      -- App-level bootstrap_owner_workspace handles reliable post-signup provisioning.
      raise warning 'handle_new_user failed for %, err=%', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user ();

