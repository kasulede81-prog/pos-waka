# Google OAuth branding — Waka POS (waka-ug.com)

This document explains why Google may show a **Supabase** hostname during sign-in, what the app enforces in code, and the **manual dashboard steps** required for production.

---

## How sign-in works

1. User taps **Continue with Google** on `https://waka-ug.com/login`.
2. Browser goes to Supabase Auth (`https://<project-ref>.supabase.co/auth/v1/authorize?provider=google&redirect_to=https://waka-ug.com/auth/callback`).
3. Google authenticates the user.
4. Google redirects to **`https://<project-ref>.supabase.co/auth/v1/callback`** (required).
5. Supabase creates the session and redirects to **`https://waka-ug.com/auth/callback`** (PKCE code).
6. `AuthCallbackPage` exchanges the code and sends the user into the app.

The **app return URL** is always `https://waka-ug.com` when `VITE_APP_URL` is set (or the production build fallback in `src/lib/authConfig.ts`).

---

## Why Google still shows `*.supabase.co`

Google displays the **Authorized redirect URI domain** used in the OAuth flow. With hosted Supabase Auth, that URI is always:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

**Client-side code cannot change that domain.** To show **waka-ug.com** (or `auth.waka-ug.com`) on the Google screen you need:

### Supabase Custom Domain (recommended for production branding)

1. Supabase Dashboard → **Project Settings → Custom Domains**.
2. Add e.g. `auth.waka-ug.com` (CNAME to Supabase).
3. Update **Google Cloud → OAuth client → Authorized redirect URIs** to:
   - `https://auth.waka-ug.com/auth/v1/callback`
4. Update **Supabase → Auth → Google provider** if prompted.
5. Keep `https://waka-ug.com/auth/callback` in **Supabase → Auth → Redirect URLs**.

Until custom domain is live, set **Google OAuth consent screen** app name/logo to **Waka POS** so users still see your brand name even if the domain line shows Supabase.

---

## Production environment variables

Set on **Vercel / CI** for Production builds:

| Variable | Production value |
|----------|------------------|
| `VITE_SUPABASE_URL` | `https://ljaedextsenbkxzzgxcg.supabase.co` (your project) |
| `VITE_SUPABASE_ANON_KEY` | Anon key (public) |
| `VITE_APP_URL` | `https://waka-ug.com` (no trailing slash) |
| `VITE_APP_NAME` | `Waka POS` (optional, PWA) |

**Do not** set `VITE_APP_URL` to `localhost` or `*.supabase.co` in production.

---

## Supabase Auth → URL configuration

**Site URL**

```text
https://waka-ug.com
```

**Redirect URLs** (add all that apply)

```text
https://waka-ug.com/**
https://waka-ug.com/auth/callback
https://waka-ug.com/auth/recovery
http://localhost:5173/**
http://localhost:5173/auth/callback
http://localhost:5173/auth/recovery
```

Remove stale preview URLs you no longer use.

**Auth → Providers → Google**

- Client ID + Client secret from Google Cloud.
- Enabled.

---

## Google Cloud Console

Project: your OAuth client used by Supabase.

### OAuth consent screen

| Field | Value |
|-------|--------|
| App name | **Waka POS** |
| User support email | `info@waka.ug` |
| App logo | Waka logo (square, ≥128px) |
| Application home page | `https://waka-ug.com` |
| Privacy policy | `https://waka-ug.com/privacy` |
| Terms of service | `https://waka-ug.com/terms` |
| Authorized domains | `waka-ug.com`, `supabase.co` |

### OAuth 2.0 Client (Web application)

**Authorized JavaScript origins**

```text
https://waka-ug.com
https://ljaedextsenbkxzzgxcg.supabase.co
```

(Add `http://localhost:5173` only on a separate dev client or for local testing.)

**Authorized redirect URIs**

```text
https://ljaedextsenbkxzzgxcg.supabase.co/auth/v1/callback
```

After custom auth domain:

```text
https://auth.waka-ug.com/auth/v1/callback
```

**Do not** add `https://waka-ug.com/auth/callback` here — Google redirects to Supabase first, not your SPA.

---

## Code reference (this repo)

| File | Purpose |
|------|---------|
| `src/lib/authConfig.ts` | `authRedirectOrigin()`, `getAuthCallbackUrl()`, production HTTPS guard |
| `src/lib/supabase.ts` | PKCE client, `detectSessionInUrl` |
| `src/hooks/useAuth.ts` | `signInWithOAuth({ redirectTo: getAuthCallbackUrl() })` |
| `src/pages/AuthCallbackPage.tsx` | Branded callback + `exchangeCodeForSession` |
| `src/pages/AuthRecoveryPage.tsx` | Password reset (`/auth/recovery`) |
| `src/components/auth/GoogleSignInButton.tsx` | Branded Google CTA + loading |

Dev-only logs: `authDevLog()` — no auth secrets logged in production.

---

## Android PWA & Capacitor

- **PWA installed from waka-ug.com:** OAuth return URL `https://waka-ug.com/auth/callback` — works as normal web.
- **Capacitor APK** (`webDir: dist`): rebuild with `VITE_APP_URL=https://waka-ug.com`. OAuth may open the system browser or navigate the WebView to `waka-ug.com`; test sign-in after each release.

---

## Verification checklist

- [ ] Production build has `VITE_APP_URL=https://waka-ug.com`
- [ ] Supabase Site URL = `https://waka-ug.com`
- [ ] Supabase redirect allowlist includes `/auth/callback` and `/auth/recovery`
- [ ] Google redirect URI = `https://<ref>.supabase.co/auth/v1/callback`
- [ ] Google consent screen shows Waka POS, privacy, terms
- [ ] Sign-in completes at `https://waka-ug.com/auth/callback` → app home
- [ ] (Optional) Supabase custom domain `auth.waka-ug.com` for full domain branding
