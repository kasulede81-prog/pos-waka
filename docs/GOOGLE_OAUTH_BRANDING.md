# Google Sign-In — Waka POS

## Two flows (web vs Android)

| | **Website** (`pos.waka.ug`) | **Android app** (Capacitor) |
|---|---------------------------|---------------------------|
| How it signs in | Google popup (GIS) → `signInWithIdToken` | System browser → **Supabase OAuth** → back to app |
| Google screen branding | Waka POS / waka.ug (your consent screen) | Same consent screen once redirect URIs are fixed |
| **Authorized JavaScript origins** | Required (`pos.waka.ug`, etc.) | Optional (`https://localhost`) |
| **Authorized redirect URIs** | Not used for GIS | **Required** — Supabase callback (see below) |

Web works today because GIS only checks **JavaScript origins**, not redirect URIs.

Android failed with **`redirect_uri_mismatch`** because **redirect URIs were empty** on your Web client — Google never saw an allowed callback for the Supabase OAuth step.

---

## Google Cloud — same Web client for both

Use one **OAuth 2.0 Client ID → Web application** (the one in Supabase and `VITE_GOOGLE_OAUTH_CLIENT_ID`).

### OAuth consent screen (Branding)

You already have this — it is why the web login shows **Waka POS** / **waka.ug**:

| Field | Your setup |
|-------|------------|
| App name | Waka POS |
| Home | `https://pos.waka.ug` or `https://waka.ug` |
| Privacy / Terms | `https://pos.waka.ug/privacy`, `/terms` |
| Authorized domains | `waka.ug`, etc. |

“Branding not shown” in Console only affects verification status for **external** users; **Testing** users (added under Audience → Test users) can still sign in.

### Web client — Authorized JavaScript origins

Keep what you have, and add the app origin:

| URI | Used for |
|-----|----------|
| `https://pos.waka.ug` | Production web |
| `https://waka.ug` | Marketing / alternate host |
| `http://localhost:5173` | Local dev |
| `https://localhost` | Capacitor Android/iOS WebView origin |

### Web client — Authorized redirect URIs (fix Android)

Click **+ Add URI** and add **exactly** (replace project ref if yours differs):

```
https://ljaedextsenbkxzzgxcg.supabase.co/auth/v1/callback
```

To find your ref: Supabase project → **Settings → API** → Project URL  
(`https://XXXX.supabase.co` → use `https://XXXX.supabase.co/auth/v1/callback`).

If you use a **custom Supabase Auth domain** (e.g. `auth.waka.ug`), also add:

```
https://YOUR_AUTH_DOMAIN/auth/v1/callback
```

You do **not** need `https://localhost/...` in Google redirect URIs for Android — that URL is only in **Supabase** redirect allowlist (below).

### Show **pos.waka.ug** on Google (“Continue to …”) on Android

Google shows the **OAuth redirect host** (`redirect_uri`). To show `pos.waka.ug` instead of `*.supabase.co`:

1. **Deploy** the app so `https://pos.waka.ug` proxies Supabase Auth (included in repo `vercel.json`):

   `/auth/v1/*` → `https://ljaedextsenbkxzzgxcg.supabase.co/auth/v1/*`

   If your Supabase **project ref** is different from `ljaedextsenbkxzzgxcg`, change the destination URL in **`vercel.json`** to match your project.

2. In **Authorized redirect URIs**, add **both** (Supabase always sends the `*.supabase.co` URI to Google; the app also uses the branded one):

   ```
   https://ljaedextsenbkxzzgxcg.supabase.co/auth/v1/callback
   https://pos.waka.ug/auth/v1/callback
   ```

   If you only add `pos.waka.ug`, you will get **`redirect_uri_mismatch`** until the Supabase URI is listed too.

The Android app routes authorize through `https://pos.waka.ug/auth/v1/...` when possible, but **must not** change Google’s `redirect_uri` (that causes `Unable to exchange external code`). Google’s “Continue to …” may still show `*.supabase.co` unless you add a Supabase custom auth domain.

**Save** the client. Wait 1–3 minutes before testing on the phone.

---

## Supabase

### Authentication → Providers → Google

- **Enabled**
- **Client ID** = same Web client ID as `VITE_GOOGLE_OAUTH_CLIENT_ID`
- **Client secret** = from the same Google Web client (Supabase OAuth needs the secret; GIS web login does not)

**Authorized Client IDs** (for web GIS): same Web Client ID.

### Authentication → URL configuration

**Site URL:** `https://pos.waka.ug`

**Redirect URLs** (allow app return after Supabase finishes Google):

```
https://pos.waka.ug/auth/callback
https://pos.waka.ug/reset-password
https://pos.waka.ug/auth/recovery
https://waka.ug/auth/callback
https://waka.ug/reset-password
https://waka.ug/auth/recovery
https://localhost/auth/callback
https://localhost/reset-password
https://localhost/auth/recovery
http://localhost:5173/auth/callback
http://localhost:5173/reset-password
http://localhost:5173/auth/recovery
```

---

## Environment

```env
VITE_APP_URL=https://pos.waka.ug
VITE_GOOGLE_OAUTH_CLIENT_ID=1069323619932-....apps.googleusercontent.com
VITE_SUPABASE_URL=https://ljaedextsenbkxzzgxcg.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

After any env change: `npm run cap:build` and reinstall the Android app.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Web works, Android `redirect_uri_mismatch` | Add `https://<project-ref>.supabase.co/auth/v1/callback` under **Authorized redirect URIs** on the Web client |
| `origin_mismatch` on web | Add exact site to **JavaScript origins** |
| `signInWithIdToken` error on web | Supabase → Google → **Authorized Client IDs** = Web Client ID |
| Android opens browser but app stays logged out | Supabase redirect URLs must include `https://localhost/auth/callback` |
| Google still shows *.supabase.co on Android | Deploy `vercel.json` proxy on `pos.waka.ug`; add `https://pos.waka.ug/auth/v1/callback` to Google redirect URIs; rebuild app |
| Pop-up blocked on web | Allow pop-ups for `pos.waka.ug` |

---

## Code map

| File | Role |
|------|------|
| `src/lib/googleIdentity.ts` | Web: GIS popup + `signInWithIdToken` |
| `src/lib/nativeOAuthBrandedProxy.ts` | Rewrite Android OAuth URL → `pos.waka.ug/auth/v1/...` (Google shows your domain) |
| `src/lib/nativeGoogleAuth.ts` | Android: browser OAuth + deep link |
| `src/hooks/useAuth.ts` | Picks web vs native Google flow |
| `docs/ANDROID.md` | Full Android build + auth notes |
