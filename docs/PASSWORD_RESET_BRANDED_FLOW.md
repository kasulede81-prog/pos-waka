# Waka POS — Branded password reset flow

**Status:** Implementation ready for review — **do not deploy** until Supabase dashboard + email template checks are done.

---

## 1. Root cause of current reset failure

The app already had `/forgot-password` and a recovery page at `/auth/recovery`, with `resetPasswordForEmail(..., { redirectTo: getAuthRecoveryUrl() })`. Links were unreliable mainly because of **gaps in the recovery landing page**, not because Supabase was unused.

| Issue | Effect |
|--------|--------|
| **PKCE + no code exchange on recovery page** | Supabase Auth uses `flowType: "pkce"` (`src/lib/supabase.ts`). Recovery emails append a `?code=…` query param. `/auth/recovery` never called `exchangeCodeForSession`, unlike `/auth/callback`. Users saw the password form without a valid recovery session → `updateUser({ password })` failed or behaved inconsistently. |
| **No token state UX** | Expired, invalid, or already-used links were not detected; users got generic errors after submitting a new password. |
| **Recovery session left active** | After reset, the temporary recovery session could remain signed in instead of a clean redirect to login (weaker alignment with “single-use” recovery). |
| **Supabase dashboard misconfiguration** (ops) | If **Site URL** or **Redirect URLs** omit the recovery path, or `VITE_APP_URL` points at the wrong host, emails may open Supabase’s default host or a URL that 404s. |
| **Path naming** | Product spec expects `/reset-password`; emails used `/auth/recovery` (works if configured, but easy to miss in allowlists). |

Passwords were never logged in app code; `reportAuthIssue` only sends status codes for auth failures.

---

## 2. Required Supabase configuration changes

Apply in **Supabase → Authentication → URL configuration** (production project).

### Site URL

```
https://pos.waka.ug
```

Must match production `VITE_APP_URL` (see `src/config/company.ts` → `WAKA_POS_URL`).

### Redirect URLs (allowlist)

Add **all** surfaces you use (wildcards optional per Supabase version):

```
https://pos.waka.ug/**
https://pos.waka.ug/auth/callback
https://pos.waka.ug/reset-password
https://pos.waka.ug/auth/recovery
https://waka.ug/**
https://waka.ug/auth/callback
https://waka.ug/reset-password
https://waka.ug/auth/recovery
http://localhost:5173/**
http://localhost:5173/auth/callback
http://localhost:5173/reset-password
http://localhost:5173/auth/recovery
https://localhost/auth/callback
https://localhost/reset-password
https://localhost/auth/recovery
```

Keep `/auth/recovery` until old reset emails expire (~24h OTP lifetime).

### Email templates (optional branding)

**Authentication → Email Templates → Reset password**

- Confirm the link target uses your app host (driven by `redirectTo` from the client).
- Customize copy/logo to Waka POS; the **link destination** must remain Supabase’s verify URL that redirects to your `redirectTo`.
- Ready-to-paste HTML: [supabase-email-templates/reset-password.md](./supabase-email-templates/reset-password.md)

### Android / Capacitor

- Deep link handler accepts `/reset-password` and legacy `/auth/recovery` (`src/lib/nativeGoogleAuth.ts`).
- Rebuild the native app after web deploy so `dist` includes the new route.

---

## 3. Required frontend changes (implemented in repo)

| Area | Change |
|------|--------|
| **Redirect target** | `getAuthRecoveryUrl()` → `https://[origin]/reset-password` (`src/lib/authConfig.ts`) |
| **New page** | `src/pages/ResetPasswordPage.tsx` — Waka-branded UI, verify link → form → success → login |
| **Session bootstrap** | `src/lib/passwordRecoverySession.ts` — `exchangeCodeForSession` + session check; maps expired/invalid errors |
| **Legacy URL** | `/auth/recovery` → redirect to `/reset-password` preserving query/hash |
| **Forgot password** | Branded layout aligned with reset page |
| **After reset** | `updateUser` then `signOut()` → user signs in with new password |
| **Allowlists** | `ActivationContext`, `nativeApp`, PWA denylist updated for `/reset-password` |

**Unchanged (correct already):**

- `requestPasswordReset` → `supabase.auth.resetPasswordForEmail` with `redirectTo: getAuthRecoveryUrl()` (`src/hooks/useAuth.ts`)
- Phone lookup via `lookup_password_reset_email` RPC
- No custom tokens; Supabase-only recovery

---

## 4. Redirect URL configuration summary

| Variable / function | Value |
|---------------------|--------|
| `VITE_APP_URL` (production build) | `https://pos.waka.ug` |
| `authRedirectOrigin()` | `VITE_APP_URL` in prod, else dev origin |
| `getAuthRecoveryUrl()` | `{origin}/reset-password` |
| `getAuthCallbackUrl()` | `{origin}/auth/callback` (signup / OAuth only) |
| Helper list | `getSupabaseAuthRedirectUrls()` in `src/lib/authConfig.ts` |

**Deploy rule:** Build with the same `VITE_APP_URL` you configure in Supabase. Mismatch is the most common production failure.

---

## 5. Target flow (after deploy)

```
Forgot Password (/forgot-password)
  → resetPasswordForEmail(email, { redirectTo: https://pos.waka.ug/reset-password })
  → User email (Supabase)
  → Browser opens /reset-password?code=…
  → bootstrapPasswordRecoverySession() exchanges code
  → User sets password + confirm
  → updateUser({ password }) → signOut()
  → Success → /login
```

---

## 6. Security notes

- Recovery uses **Supabase-issued** OTP/PKCE only; no app-generated tokens.
- Passwords are **not** logged; auth telemetry uses status codes only.
- Recovery `code` is stripped from the URL after exchange (`history.replaceState`).
- User is **signed out** after reset so the recovery session is not reused for POS access.
- Invalid/expired links never show the password form.

---

## 7. Testing checklist (before production deploy)

### Supabase / env

- [ ] Site URL = `https://pos.waka.ug`
- [ ] Redirect URLs include `/reset-password` and legacy `/auth/recovery`
- [ ] Production build uses `VITE_APP_URL=https://pos.waka.ug`
- [ ] Email provider enabled; send test reset to a real inbox

### Web (Chrome)

- [ ] `/forgot-password` → submit email → receive email within 2 min
- [ ] Link opens **pos.waka.ug** `/reset-password` (not `*.supabase.co` UI)
- [ ] Page shows “Verifying…” then password form
- [ ] Mismatch confirm → inline error, no API call
- [ ] Password &lt; 8 chars → inline error
- [ ] Valid reset → success → `/login` → sign in with **new** password
- [ ] Old password rejected at login
- [ ] **Reuse** same email link → expired/invalid message, link to forgot-password
- [ ] **Expired** link (wait &gt; 1h or use old email) → expired message

### Phone lookup

- [ ] Forgot password with Uganda phone (profile has recovery email) → email sent to mapped address
- [ ] Phone with no recovery email → clear error message

### Android (Capacitor)

- [ ] Reset email opened on device → app or browser lands on `/reset-password`
- [ ] Complete reset → login in app with new password

### Regression

- [ ] Register / email verify still uses `/auth/callback`
- [ ] Google sign-in unchanged
- [ ] Settings → change password (logged-in) still works via `updatePassword` if exposed there

### Security

- [ ] DevTools network/console: no password values in logs or analytics payloads

---

## 8. Android manifest

`android/app/src/main/AndroidManifest.xml` declares deep links for Capacitor (`https://localhost`):

- `/auth/callback`
- `/reset-password`
- `/auth/recovery` (legacy)

Rebuild the APK/AAB after web deploy: `npm run build` → `npx cap sync android`.

---

## 9. Reviewer sign-off

- [ ] Supabase dashboard updated
- [ ] `npm run build` with production env
- [ ] Staging smoke test on checklist above
- [ ] Approve deploy to production

---

## File reference

| File | Role |
|------|------|
| `src/hooks/useAuth.ts` | `requestPasswordReset`, `updatePassword` |
| `src/lib/authConfig.ts` | `getAuthRecoveryUrl`, redirect allowlist helper |
| `src/lib/supabase.ts` | `detectSessionInUrl`, `flowType: "pkce"` |
| `src/lib/passwordRecoverySession.ts` | Recovery bootstrap |
| `src/pages/ResetPasswordPage.tsx` | Branded reset UI |
| `src/pages/ForgotPasswordPage.tsx` | Request reset email |
| `src/pages/AuthRecoveryPage.tsx` | Legacy redirect |
| `docs/DEPLOYMENT.md` | General auth deploy notes |
