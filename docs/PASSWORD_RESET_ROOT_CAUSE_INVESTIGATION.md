# Password reset — root cause investigation (2026-05-31)

## Symptoms (confirmed from production)

| Step | Status |
|------|--------|
| Request reset | ✓ |
| Email delivery | ✓ (default Supabase template still OK if `{{ .ConfirmationURL }}`) |
| Click link → `pos.waka.ug` | ✓ |
| Branded `/reset-password` loads | ✓ |
| Session bootstrap | ✗ → **"Reset link not valid"** / *invalid or was already used* |

Screenshot context: link opened from **WhatsApp in-app browser** (~1 minute after email).

---

## Exact failing step

**Step 5 — PKCE session bootstrap on `/reset-password`** (`bootstrapPasswordRecoverySession` in `src/lib/passwordRecoverySession.ts`).

The page never reaches `ready`; it returns `invalid` with message from `recoveryMessageFromAuthError()` — specifically the branch for *"already been used"* / *"invalid"*.

---

## Root cause (primary): one-time `code` consumed twice

Supabase client is created with:

```ts
detectSessionInUrl: true,
flowType: "pkce",
```

(`src/lib/supabase.ts`)

When the email redirect lands as:

```
https://pos.waka.ug/reset-password?code=<ONE_TIME_CODE>
```

1. **Supabase Auth (on client init)** auto-detects `code` and exchanges it for a recovery session.
2. **`ResetPasswordPage`** then runs `bootstrapPasswordRecoverySession()`, sees the same `code` still in the query string, and calls **`exchangeCodeForSession(code)` again**.
3. The second exchange fails (code already redeemed) → error message contains *"already been used"* or *"invalid"* → UI shows **Reset link not valid**.

`/auth/callback` is less brittle because it uses `onAuthStateChange` and tolerates an existing session; recovery bootstrap **did not** re-check session after exchange failure.

This matches:

- Immediate failure (no form shown)
- Exact copy: *"invalid or was already used"*
- Email and redirect working (code was present at least once)

---

## Contributing factors

### A — WhatsApp / in-app browser

- May open links in embedded WebView.
- Some clients **prefetch** links (consumes one-time tokens before the user taps).
- Hash-based tokens (`#access_token=...`) are often stripped; PKCE `?code=` is usually kept, but prefetch still breaks one-time codes.

**Test:** Copy link → paste in Chrome/Safari (not WhatsApp). If it works there, prefetch/in-app browser is involved.

### B — Missing `token_hash` handler

If Supabase (or a custom template) sends:

```
/reset-password?token_hash=...&type=recovery
```

without going through the verify redirect, the app only waited briefly and never called `verifyOtp()`. Fixed in code alongside the PKCE race.

### C — Ops misconfiguration (less likely here)

If `redirect_to` were wrong, user would often land without `code` and see *"Open the reset link from your email"* (different copy). Branded page + *already used* points to **code present then rejected**, not missing redirect.

Still verify in Supabase Dashboard:

| Setting | Expected |
|---------|----------|
| Site URL | `https://pos.waka.ug` |
| Redirect URLs | includes `https://pos.waka.ug/reset-password` and `https://pos.waka.ug/**` |
| Email template link | `{{ .ConfirmationURL }}` (not raw `{{ .SiteURL }}` only) |
| Production build | `VITE_APP_URL=https://pos.waka.ug` |

### D — Default email template

The inbox screenshot shows Supabase’s default *"Reset Password"* template. That is fine **if** the button uses `{{ .ConfirmationURL }}`. Custom Waka HTML is optional branding only.

---

## URL shape reference

| After Supabase verify (PKCE) | Handled by |
|------------------------------|------------|
| `?code=...` | `exchangeCodeForSession` (once) |
| `?token_hash=...&type=recovery` | `verifyOtp` |
| `#access_token=...&type=recovery` | `detectSessionInUrl` + wait |
| `?error=...` | `parseOAuthCallbackError` |
| *(none)* | No session → invalid |

**Expected email link (first hop):**

```
https://<project-ref>.supabase.co/auth/v1/verify?token=...&type=recovery&redirect_to=https%3A%2F%2Fpos.waka.ug%2Freset-password
```

**Expected landing (second hop):**

```
https://pos.waka.ug/reset-password?code=<pkce_code>
```

---

## Required fix (minimal — no flow redesign)

1. **Before** `exchangeCodeForSession`: if `getSession()` already has a session → `ready`, strip URL.
2. **After** exchange error: re-check `getSession()` (auto-detect may have won the race).
3. **`verifyOtp`** for `token_hash` + `type=recovery`.
4. **DEV diagnostics**: log query/hash **keys only** (never token values).
5. **Ops:** advise users to open reset links in Chrome; avoid WhatsApp preview for testing.

Implemented in `src/lib/passwordRecoverySession.ts`.

---

## Verification checklist

- [ ] Request reset → email → open in **Chrome** → password form appears
- [ ] Same link clicked twice → expired/invalid (expected)
- [ ] DevTools (DEV build): `[waka-auth] recovery URL shape` shows `hasCode: true` or `hasTokenHash: true`
- [ ] After fix: no `exchangeCodeForSession failed` when session already exists
- [ ] `updateUser({ password })` → sign out → login with new password

---

## Flow diagram (fixed)

```
Email → supabase.co/auth/v1/verify → pos.waka.ug/reset-password?code=...
         ↓
  detectSessionInUrl exchanges code (async)
         ↓
  bootstrap: getSession() → if session → ready
         ↓ else
  exchangeCodeForSession OR verifyOtp
         ↓ on error
  getSession() again → if session → ready
         ↓
  Password form → updateUser → signOut → /login
```
