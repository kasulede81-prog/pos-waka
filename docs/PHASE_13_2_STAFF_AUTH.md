# Phase 13.2 — Enterprise Staff Authentication & Lock Screen

## Summary

Phase 13.2 delivers a unified staff authentication layer without modifying the Phase 13.1 permission engine, Owner PIN, SensitiveActionGate, or business logic.

## Deliverables

| Area | Location |
|------|----------|
| Auth framework | `src/lib/auth/` |
| Enterprise lock screen | `src/components/auth/EnterpriseStaffLockScreen.tsx` |
| PIN keypad | `src/components/auth/EnterprisePinKeypad.tsx` |
| Staff login UI | `src/components/auth/EnterpriseStaffLoginPanel.tsx` |
| Auto-lock hook | `src/hooks/useStaffAutoLock.ts` |
| Security settings | `src/pages/SettingsStaffSecurityPage.tsx` |

## Architecture

```
Staff PIN → staffAuthentication → staffSession → Permission Engine (unchanged)
Lock/unlock → staffLockScreen → staffSessionAudit → existing audit log
Brute-force → staffLoginLimiter (30s → 60s → 5min tiers)
```

## Regression checklist

| Check | Status |
|-------|--------|
| Permission matrix unchanged | ✓ |
| Owner PIN / SensitiveActionGate unchanged | ✓ |
| Cloud sync / offline persistence unchanged | ✓ |
| Staff login (offline PIN) | ✓ wired |
| Lock / unlock | ✓ via `staffLockScreen` |
| Switch user | ✓ via `staffSwitchUser` |
| Auto-lock settings | ✓ Settings → Staff security |
| Session restore (staff offline) | ✓ `useAuth` + `staffSession` |
| Brute-force on lock screen | ✓ `staffLoginLimiter` |
| Audit events | ✓ `pos_lock`, `pos_unlock`, `staff_switch_user`, etc. |
| Build | ✓ `npm run build` |
| Unit tests | ✓ `src/lib/auth/staffAuth.test.ts` |

## Not changed (by design)

- `permissions.ts` / `enterpriseRoles/` permission resolution
- `EnterpriseSecurityService` Owner/back-office PIN
- Inventory, sales, financial engines
- `switchStaffAccount` shift-open guard (preserved)

## Manual QA suggested

1. Owner login → Lock POS → unlock with staff PIN and back-office PIN
2. Switch user on lock screen (Business/Waka Plus tier)
3. Staff sign-in from login page (offline cached shop)
4. Settings → Staff security → auto-lock 2 min → idle → auto lock
5. Five wrong PINs on lock screen → progressive lockout
6. Refresh browser with remember session → resume without full login
