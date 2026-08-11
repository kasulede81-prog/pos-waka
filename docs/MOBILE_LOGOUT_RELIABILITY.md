# Phase M0.1 — Enterprise Mobile Logout Reliability

**Date:** 2026-08-08  
**Scope:** Logout reliability on iOS, Android, Desktop, Web  
**Non-goals:** UI redesign · auth architecture rewrite · POS / Inventory / Vision / Offline engine changes

---

## Root cause

On Capacitor iOS (and flaky networks), `useAuth.signOut` **awaited** `supabase.auth.signOut()` **before** clearing local session state.

If that network call hung or failed:

1. The profile menu still closed (`setMenuOpen(false)`).
2. React auth state stayed signed-in.
3. Offline session resilience could **defer `SIGNED_OUT`** and restore a cached `auth-token` from `localStorage`.

Result: Logout appeared to do nothing; cold restart could still restore the session.

---

## Fix

Single central action: `performEnterpriseLogout` in `src/lib/auth/enterpriseLogout.ts`.

`useAuth.signOut`, `hardSignOutToLogin`, and all UI entry points funnel through it.

### Ordered flow

```text
Logout tap
  → prevent double-tap (in-flight latch)
  → cancel session refresh + scheduled background sync
  → flush persist / clear active staff
  → Zustand resetForSignOut + clear active account key
  → clear staff session markers
  → clear React Query caches
  → remove Supabase auth-token keys from localStorage  ← before SIGNED_OUT handlers
  → clear sessionStorage
  → supabase.auth.signOut({ scope: "local" }) with timeout (offline-safe)
  → best-effort global revoke if online (non-blocking)
  → window.location.replace("/login")  ← replaces history; Back cannot return
```

### Offline

Local scope sign-out + token wipe do not require network. Logout always completes offline.

### Capacitor

Auth persistence is WebView `localStorage` (see `src/lib/supabase.ts`).  
Capacitor Preferences hold UI language / update flags — **not** cleared (not auth).  
Biometric APIs store no WAKA tokens. Offline shop IndexedDB namespaces are **preserved** for the next login (not an account wipe).

---

## Entry points (all → `auth.signOut` → `performEnterpriseLogout`)

| Surface | Path |
|---------|------|
| Desktop / mobile profile menu | `AppShell` |
| Account / Settings logout | `AccountPage` |
| Emergency lock-screen logout | `AppShell` → `EnterpriseStaffLockScreen` |
| Startup escape / recovery | `StartupEscapeActions`, `PosDataProvider` |
| Device limit | `DeviceLimitReachedPage` |
| Onboarding | `ShopOnboardingPage` |
| Auth callback recovery | `hardSignOutToLogin` |
| Password reset | `ResetPasswordPage` |

UI busy guard: `useLogoutAction`.

---

## Regression protection

| Must not change | Status |
|-----------------|--------|
| POS / Inventory / Vision / Reports / Cash Drawer | Untouched |
| Permissions / Subscriptions | Untouched |
| Offline shop data engine (IndexedDB namespaces) | Preserved; only auth session cleared |
| Offline “stay signed in while flaky” for **involuntary** SIGNED_OUT | Still defers when `explicitSignOut` is false |

---

## Platforms / verification

| Check | Result |
|-------|--------|
| Unit tests (`enterpriseLogout.test.ts`) | Automated |
| `npm run build` | Required before ship |
| `npm test` | Required before ship |
| Web / Desktop | Manual — logout → Login; Back stays on Login |
| iPhone Simulator | Manual — logout → Login; kill app → reopen → Login |
| Offline logout | Manual — airplane mode → Logout → Login |
| Cold restart after logout | Manual — no auto re-login |
| Logout while sync running | Manual — still lands on Login |

### iOS Simulator checklist

1. `npm run ios` (or rebuild + Run in Xcode).
2. Sign in.
3. Open profile menu → Logout (button disables while busy).
4. Confirm Login screen.
5. Press iOS Back / swipe — must not return to authenticated shell.
6. Kill app from app switcher → relaunch → Login.
7. Enable airplane mode → sign in (cached) if needed → Logout → still Login.

---

## Key files

| File | Role |
|------|------|
| `src/lib/auth/enterpriseLogout.ts` | Central logout |
| `src/hooks/useAuth.ts` | `signOut` delegates here |
| `src/hooks/useLogoutAction.ts` | Double-tap UI guard |
| `src/lib/authRecovery.ts` | `hardSignOutToLogin` wrapper |
| `src/lib/queryClient.ts` | Shared QueryClient cleared on logout |
| `src/offline/cloudSync.ts` | `cancelBackgroundCloudSync` |

---

*End of Phase M0.1.*
