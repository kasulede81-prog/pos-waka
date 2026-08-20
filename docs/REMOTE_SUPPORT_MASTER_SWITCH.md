# WAKA POS — Remote Support Master Switch (RS-FREEZE-1)

## Purpose

Freeze Remote Support development behind a global Admin Center switch so the installed control plane and Electron boundary cannot be used accidentally while core POS work continues.

This is a **feature gate only**. It does not add a second support architecture.

- `support_requests` = Need Help tickets (unchanged)
- `remote_support_requests` / `remote_support_sessions` / `remote_support_session_events` = authorization (unchanged tables)
- `electron/remoteSupport` = native transport boundary (unchanged adapter design)

## Default state

**OFF**

- Code stays in the repo.
- Remote Support tables stay as they are.
- RustDesk transport flag still defaults to `off`.
- The master switch defaults to `{ "enabled": false }` in `platform_settings`.
- Missing row, failed RPC, or omitted `enabled: true` is treated as **disabled** (fail closed).

## Feature flag location

Reuses existing `public.platform_settings` (same store as POS Display Scale and subscription settings).

| Piece | Location |
|---|---|
| Row | `platform_settings.key = 'remote_support'` |
| Read | `get_remote_support_platform_settings()` |
| Write | `admin_update_remote_support_platform_settings(p_enabled)` |
| Helper | `remote_support_is_enabled()` (not granted to clients) |
| UI | Admin Center → System → Remote Support (`/internal/waka/remote-support`) |

## Enable process

1. Apply migration `155_remote_support_master_switch.sql` on the target environment (lab first).
2. Sign in as `super_admin` or `support_admin`.
3. Open **Admin Center → System → Remote Support**.
4. Confirm status **DISABLED**, then **Enable Remote Support**.
5. Lab transport still requires `WAKA_REMOTE_SUPPORT_TRANSPORT=lab` on the Windows process. Enabling the switch does **not** turn on production RustDesk.

To freeze again: **Disable Remote Support**. Existing Need Help tickets are unaffected.

## Security behavior

Enforced in three places. A modified React app cannot bypass the switch.

1. **Admin UI** — only `super_admin` and `support_admin` (`waka_can_remote_support` / `canRemoteSupport`) can toggle. Other internal roles see the page read-only.
2. **RPC** — `remote_support_request_start`, `remote_support_customer_approve`, `remote_support_customer_inbox`, and `remote_support_grant_assert` return `remote_support_disabled` or an empty inbox when off. End/cancel/revoke/expire still work so leftover sessions can be cleaned up.
3. **Electron** — native snapshot loads the platform setting. Authorization requires `remoteSupportEnabled === true`. Otherwise start is rejected and a running watchdog fail-closes the process.

When disabled:

- POS hides the Remote Assistance card and approval host.
- Admin hides Connect Remotely.
- Need Help remains available.

## How to resume development later

1. Keep this switch **OFF** on production.
2. On a lab project with migrations 151–155 applied, enable the switch from Admin Center.
3. Use the existing isolated lab env for RustDesk (`docs/REMOTE_SUPPORT_RS4D_LAB_SETUP.md`). Do not bake `lab` into the EXE.
4. Continue from the current Remote Support modules. Do not create a parallel session table or a second Need Help path.
