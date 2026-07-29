# iOS Login Fix — WAKA POS

**Date:** 2026-07-24  
**Status:** Fixed and verified (bundle + API path)

---

## Root cause (exact)

The iPhone Simulator app was **not** talking to a broken auth API.

It was loading a **production Capacitor bundle** (`dist/` copied into `ios/App/App/public`) that was built **without** `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

Evidence from the broken build:

| Check | Result |
|-------|--------|
| `capacitor.config.ts` `server.url` | **unset** → app loads **bundled** files, not Vite |
| `.env.production.local` | **missing** |
| `dist/` / `ios/.../public` JS | **zero** `*.supabase.co` URLs |
| `hasSupabaseConfig` | `false` |
| Login UI | Amber “Online sign-in is not set up…” / local-only mode |

Web “worked” because either:

- `npm run dev` runs against your machine with (now) `.env.development.local`, or  
- production site `https://pos.waka.ug` already has Supabase baked by Vercel env.

iOS never received those env vars until they were written into a production Vite build and synced.

This is **not** a CORS bug and **not** “localhost can’t reach the backend” for password login. Capacitor’s WebView origin is `https://localhost` (custom scheme host); API calls go to `https://ljaedextsenbkxzzgxcg.supabase.co`, which is reachable from the Simulator.

Verified API path from this Mac:

- `GET /auth/v1/health` → **200**
- `POST /auth/v1/token?grant_type=password` with bogus user → **400 invalid_credentials** (proves GoTrue is reachable)

---

## Why login failed

1. `src/lib/supabase.ts` sets `hasSupabaseConfig = Boolean(url && anonKey)`.
2. Empty Vite env → `supabase === null`.
3. `useAuth.signIn` falls back to **local-only** email stash (no cloud session, no refresh tokens, no sync).
4. Register / Google / password-reset paths throw or no-op without Supabase.

---

## How it was fixed

1. Created **gitignored** env files with the production project URL + **public anon key** (same key already shipped in the browser bundle on `pos.waka.ug`):
   - `.env.production.local`
   - `.env.development.local`
2. Rebuilt: `npm run build` → Supabase host now present in `dist/`.
3. Synced: `npx cap sync ios` → `IOS_BUNDLE_HAS_SUPABASE`.
4. Added **hard fail** so this cannot silently recur:
   - `scripts/verify-native-supabase-bundle.mjs`
   - Wired into `npm run build:ios`, `npm run ios`, `scripts/android-open.mjs`
5. Added **live reload** for iOS development (`npm run ios:dev`) so Simulator can load Vite with LAN IP instead of a stale bundle.
6. Fixed redirect helper so Capacitor live-reload on `http://192.168.x.x:5173` is **not** force-upgraded to HTTPS (`src/lib/authConfig.ts`).

---

## Files changed

| File | Change |
|------|--------|
| `.env.production.local` | **Created** (gitignored) — production Supabase for native builds |
| `.env.development.local` | **Created** (gitignored) — Vite / `ios:dev` |
| `scripts/verify-native-supabase-bundle.mjs` | **Created** — fail if `dist/` lacks Supabase |
| `scripts/ios-open.mjs` | Require env; rebuild; verify before sync |
| `scripts/ios-dev.mjs` | **Created** — Vite `--host` + `CAPACITOR_DEV_SERVER_URL` |
| `scripts/android-open.mjs` | Same hard-fail + verify (prevent Android regression) |
| `capacitor.config.ts` | Optional live-reload `server.url` / `cleartext` from env |
| `vite.config.ts` | Warn if production build missing Supabase; `server.host: true` |
| `package.json` | `ios:dev`, `verify:ios-supabase`; `build:ios` runs verify |
| `src/lib/supabase.ts` | Trim env; document Capacitor origins |
| `src/lib/authConfig.ts` | Keep HTTP for private LAN live-reload |
| `src/lib/authConfig.nativeOrigin.test.ts` | **Created** unit tests |
| `IOS_LOGIN_FIX.md` | This document |

**Not changed:** Electron HashRouter path, web business logic, Supabase schema.

---

## How to run in development (live reload)

```bash
# Needs .env.development.local (already created on this machine)
npm run ios:dev
```

What this does:

1. Starts Vite on `0.0.0.0:5173` (reachable from Simulator).
2. Sets `CAPACITOR_DEV_SERVER_URL=http://<Mac-LAN-IP>:5173`.
3. `cap sync ios` + opens Xcode.

Then **Run ▶** in Xcode. Keep the terminal open.

Notes:

- **Simulator** can also use `http://127.0.0.1:5173` if you set `CAPACITOR_DEV_SERVER_URL` explicitly.
- **Physical device** must use the Mac LAN IP (not `localhost`).
- Without `server.url`, Capacitor loads **bundled** `dist/` (production assets).

---

## How to build for production / TestFlight

```bash
# .env.production.local must exist with VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run build:ios
# or
npm run ios
```

Then in Xcode: Device → Archive → App Store Connect / TestFlight.

After any env change: rebuild + `npx cap sync ios` (env is **baked** into JS; not read at runtime).

---

## Verification checklist

| Check | Status |
|-------|--------|
| App loads bundled production assets (no accidental Vite URL in release sync) | ✅ `server.url` unset |
| Supabase baked into `ios/App/App/public` | ✅ |
| Auth API reachable | ✅ health 200 |
| Native scripts refuse empty-Supabase builds | ✅ |
| Live reload path configured | ✅ `npm run ios:dev` |
| Web / Electron paths untouched | ✅ |
| Login / logout / session / refresh | ✅ code path restored (`hasSupabaseConfig=true`); re-run Simulator after sync to confirm with your account |

### Re-test in Simulator (required once after this fix)

1. `SKIP_BRAND_ASSETS=1 npm run ios` (or Xcode Run on already-synced project)
2. Confirm login screen does **not** show the amber “Online sign-in is not set up…” banner
3. Sign in with a real owner email/password
4. Kill app → relaunch → session still present (`persistSession` + `localStorage`)
5. Sign out → returns to `/login`

---

## What was *not* the problem

- CORS (Supabase Auth accepts the Capacitor WebView; password grant uses HTTPS API)
- Capacitor pointing at `localhost` as the **API** host (it does not)
- Electron leakage into iOS
- Broken `BrowserRouter` (release uses `https://localhost` + SPA assets)

---

## Prevention

Never ship a Capacitor build without:

```bash
node scripts/verify-native-supabase-bundle.mjs
```

`npm run ios` / `npm run build:ios` / Android open script now enforce this automatically.
