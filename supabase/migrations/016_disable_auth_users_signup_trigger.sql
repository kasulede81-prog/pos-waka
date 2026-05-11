-- Final safety net: disable legacy auth.users post-insert trigger.
-- Workspace provisioning is app-controlled via bootstrap_owner_workspace RPC.

drop trigger if exists on_auth_user_created on auth.users;

