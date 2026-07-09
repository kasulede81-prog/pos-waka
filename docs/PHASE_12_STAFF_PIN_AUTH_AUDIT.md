# Phase 12 — Staff PIN Authentication Audit

## Summary

Staff PIN security **primitives are enterprise-grade**; the **product flow is owner-centric** (lock screen user switch vs dedicated staff login page).

## Flow map

| Step | Implementation | Status |
|------|----------------|--------|
| PIN generation | `generateStaffPin()` — 4-digit, weak-pin filter | OK |
| PIN storage | Argon2id via `hashStaffSecret.ts` | OK |
| Staff login API | `authenticateOfflineStaff()` | OK |
| Staff login UI | `LoginPage` — **not wired** | Gap |
| Lock screen | `AppShell.tsx` — staff list + PIN | OK |
| User switch | `switchStaffAccount()` | OK |
| Owner PIN | `backOfficePin` / `EnterpriseSecurityService` | Separate OK |
| Offline auth | Encrypted staff cache | OK |
| Cloud sync | `shopStaffCloud`, `staffCacheSync` | OK |
| Lockout | 5 attempts / 15 min (`staffLoginSecurity`) | OK on login path |
| Lock screen brute force | No attempt recording | **Gap** |

## Owner vs Staff PIN

| | Staff PIN | Owner Security PIN |
|---|-----------|-------------------|
| Storage | `StaffAccount.pinHash` | `preferences.backOfficePin` |
| Use | Daily login, lock screen | Settings, sensitive ops, back office |
| Verifier | `staffSecretMatchesAsync` | `verifyShopSecurityPinAsync` |

## Recommended follow-ups

1. Wire staff login UI on `/login` (backend exists)
2. Apply lockout to lock screen unlock path
3. Restore staff session on boot when `rememberDevice`
4. Terminal-level rate limiting (not just per-account)

## Key files

- `src/lib/staffOfflineAuth.ts`
- `src/lib/staffSecret.ts`
- `src/lib/staffLoginSecurity.ts`
- `src/components/layout/AppShell.tsx`
- `src/lib/enterpriseSecurity/EnterpriseSecurityService.ts`
