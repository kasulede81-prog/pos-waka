# Google Sign-In — Waka POS (GIS popup only)

## Final flow (implemented)

```
User → Continue with Google (Waka button)
     → Google Identity Services popup (Waka POS name + logo)
     → ID token returned in browser (JavaScript callback)
     → supabase.auth.signInWithIdToken({ provider: 'google', token })
     → Supabase session (no browser redirect to supabase.co)
```

**Not used:** `signInWithOAuth`, `redirectTo` for Google, PKCE redirect to Supabase, or `https://*.supabase.co/auth/v1/callback` in Google Cloud.

---

## Google Cloud setup

### OAuth consent screen

| Field | Value |
|-------|--------|
| App name | **Waka POS** |
| Logo | Waka Technologies logo |
| Home | `https://waka.ug` |
| Privacy | `https://waka.ug/privacy` |
| Terms | `https://waka.ug/terms` |

### OAuth 2.0 Client ID → **Web application**

| Setting | Value |
|---------|--------|
| **Authorized JavaScript origins** | `https://pos.waka.ug` |
| | `https://waka.ug` |
| | `http://localhost:5173` (local dev only) |
| **Authorized redirect URIs** | **Leave empty** for GIS popup — do **not** add `*.supabase.co/auth/v1/callback` |

Copy the **Client ID** → `VITE_GOOGLE_OAUTH_CLIENT_ID`.

### Supabase

**Authentication → Providers → Google**

- Enable Google provider (client secret can stay for dashboard compatibility).
- **Authorized Client IDs:** add the **same Web Client ID** (required for `signInWithIdToken`).

**Authentication → URL configuration**

- Site URL: `https://pos.waka.ug`
- Redirect URLs: still needed for **email** and **password reset**, not for Google GIS login:
  - `https://pos.waka.ug/auth/callback`
  - `https://pos.waka.ug/auth/recovery`
  - `https://waka.ug/auth/callback` (if marketing host serves the same app)
  - `https://waka.ug/auth/recovery`

---

## Production environment (Vercel)

```env
VITE_APP_URL=https://pos.waka.ug
VITE_GOOGLE_OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com
VITE_SUPABASE_URL=https://YOUR_REF.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

Redeploy after setting `VITE_GOOGLE_OAUTH_CLIENT_ID`. Without it, the Google button is hidden and a config message is shown.

---

## Code map

| File | Role |
|------|------|
| `src/lib/googleIdentity.ts` | GIS script, `ux_mode: 'popup'`, `requestGoogleIdToken()` |
| `src/hooks/useAuth.ts` | `signInWithIdToken` only for Google |
| `src/components/auth/GoogleSignInButton.tsx` | Waka-branded trigger |
| `src/pages/LoginPage.tsx` / `RegisterPage.tsx` | Google button when client ID is set |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Google button missing / amber warning | Set `VITE_GOOGLE_OAUTH_CLIENT_ID` and redeploy |
| Pop-up blocked | Allow pop-ups for `pos.waka.ug` |
| `signInWithIdToken` error | Add Client ID under Supabase → Google → Authorized Client IDs |
| Still need supabase.co in Google redirect URIs | Old build or old tab — hard refresh; confirm env var in Vercel **Production** |
| GIS error `origin_mismatch` | Add exact origin to Google **JavaScript origins** |

---

## Verify (no Supabase OAuth redirect)

1. Open DevTools → Network.
2. Click **Continue with Google**.
3. Confirm there is **no** navigation to `supabase.co/auth/v1/authorize`.
4. A **popup** from `accounts.google.com` should appear.
5. After choosing an account, you stay on `pos.waka.ug` with a session (no full-page redirect to Supabase).
