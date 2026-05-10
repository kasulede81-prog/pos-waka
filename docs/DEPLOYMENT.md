# Waka POS — production deployment

This guide covers **Vercel** hosting, **Supabase** cloud, **multi-environment** env files, **PWA**, **Android**, and **offline-first** safety checks.

---

## 1. Environment variables (checklist)

All browser-exposed variables must use the `VITE_` prefix. **Never** put the Supabase **service role** key in Vite env or client code.

| Variable | Required | Used for |
|----------|----------|----------|
| `VITE_SUPABASE_URL` | For cloud auth/sync | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | For cloud auth/sync | Supabase anon (public) key — RLS must protect data |
| `VITE_APP_URL` | **Strongly recommended** in hosted envs | `authRedirectOrigin()` — email verify, password reset, OAuth callback base (no trailing slash) |
| `VITE_APP_NAME` | Optional | PWA manifest full name |
| `VITE_APP_SHORT_NAME` | Optional | PWA manifest short name |
| `VITE_MONITORING_INGEST_URL` | Optional | HTTPS endpoint for JSON POST from `src/lib/monitoring.ts` (ops only; keep vendor UI friendly) |

Copy examples:

- `.env.example` — overview  
- `.env.development.example` → `.env.development.local`  
- `.env.staging.example` → `.env.staging.local`  
- `.env.production.example` → `.env.production.local`  

**Vercel:** Project → Settings → Environment Variables. Use **Preview** for staging branch and **Production** for main. Same keys as in `.env.production.local` when testing locally.

**Build commands:**

- `npm run build` / `npm run build:production` — `production` mode (default for Vercel if `NODE_ENV=production`).
- `npm run build:staging` — `staging` mode (loads `.env.staging` + `.env.staging.local`).

---

## 2. Vercel

1. Connect the Git repo to Vercel; framework **Vite** is auto-detected.
2. Set env vars (section 1) for Preview and Production.
3. `vercel.json` in the repo:
   - **Rewrites** SPA routes to `/index.html` (static files in `dist/` are still matched first).
   - **Headers:** long cache for hashed assets; **no long cache** for `index.html`, `sw.js`, and workbox scripts so new deploys apply.

**Branch previews:** Point staging Supabase **Redirect URLs** at `https://*.vercel.app` patterns or your preview domain.

**Offline shell:** The PWA service worker precaches the built shell; `navigateFallback` is `/index.html`. Supabase API uses **NetworkFirst** in `vite.config.ts` so selling stays local-first while online calls prefer the network.

---

## 3. Supabase production

1. Create a **production** project (separate from dev/staging recommended).
2. Run SQL migrations from `supabase/migrations/` in order (CLI: `supabase db push` or paste in SQL editor).
3. **Auth → URL configuration**
   - **Site URL:** production `VITE_APP_URL` (e.g. `https://pos.yourdomain.com`).
   - **Redirect URLs** (add every surface you use), for example:
     - `http://localhost:5173/**`
     - `http://localhost:5173/auth/callback`
     - `http://localhost:5173/auth/recovery`
     - `https://your-staging.vercel.app/**`
     - `https://your-staging.vercel.app/auth/callback`
     - `https://your-staging.vercel.app/auth/recovery`
     - `https://your-production-domain.com/**`
     - `https://your-production-domain.com/auth/callback`
     - `https://your-production-domain.com/auth/recovery`
4. **Email templates** — ensure links use the redirect host Supabase generates (tied to `emailRedirectTo` / `redirectTo` in `src/hooks/useAuth.ts`, which use `authRedirectOrigin()` from `VITE_APP_URL` or `window.location.origin`).
5. **Secrets:** service role key only in Edge Functions / backend jobs — **not** in this SPA.

---

## 4. Security review (short)

- **RLS:** Policies in `008_row_level_security.sql` (and later migrations) must scope reads/writes by `shop_id` / membership. Re-audit when adding new tables.
- **Roles:** Client enforces cashier/owner UI; **server** must enforce via RLS and (where used) RPC privileges.
- **Audit logs:** Treat as sensitive; sync payload should stay shop-scoped when you wire remote persistence.
- **Env:** Anon key in the browser is expected; protection = RLS + auth, not hiding the anon key.

---

## 5. PWA production

- Manifest is generated at build time; names come from `VITE_APP_NAME` / `VITE_APP_SHORT_NAME`.
- Icons use `public/favicon.svg` for install surfaces that accept SVG. For maximum Android install compatibility, you may add `pwa-192x192.png` / `pwa-512x512.png` under `public/` and extend the `manifest.icons` array in `vite.config.ts`.
- After deploy, verify **Install app**, offline open, and that a new deployment updates the SW (`registerType: "autoUpdate"`).

---

## 6. Android (Capacitor)

1. `npm run build` with the **same** `VITE_*` values you want in the app (they are inlined at build time).
2. `npm run cap:sync` then open Android Studio (`npm run cap:open:android`).
3. Release signing: `android/README-RELEASE.md`.

`capacitor.config.ts` uses `webDir: "dist"`. There is no runtime “switch” for Supabase URL on device beyond rebuilding after env change.

---

## 7. Offline-first & sync safety

- Sales and stock live in **IndexedDB** (`src/offline/localDb.ts`); the app works with **no** Supabase env.
- The **sync queue** persists operations; `flushSyncQueue` retries with bounded attempts and reports `sync_flush_error` / `sync_queue_corrupt` via `src/lib/monitoring.ts` without changing local sales.
- Deploying a new web version does **not** wipe IndexedDB on users’ phones.

**Post-deploy verification (operators):**

1. Open deployed URL, sign in, complete a sale **offline** (airplane mode), confirm receipt/stock updates.
2. Go online; confirm queue drains without duplicate errors (when remote sync is fully implemented).
3. Force refresh after deploy; confirm SW updates and app still loads offline.

---

## 8. Monitoring (optional)

Set `VITE_MONITORING_INGEST_URL` to your collector. Payload shape: `{ category, code, meta?, env, ts }`.  
Use this for **ops dashboards**, not in-shop banners. UI copy should stay non-technical (`src/lib/monitoring.ts`).

Hooks today:

- Sync flush failures / queue write failures (`syncEngine.ts`)
- Auth failures (`useAuth.ts` — status codes only, no email/password)
- Service worker registration errors (`main.tsx`)

---

## 9. Backups

- **Local export / restore:** Settings (shop permission) — JSON backup; daily snapshots in IndexedDB.
- **Future cloud backups:** keep envelope format versioned (`backupEngine.ts`); optional upload to Supabase Storage from a **server** using service role — not implemented in the SPA by design.

---

## 10. Deployment checklist

### Vercel

- [ ] Env vars set for Preview + Production  
- [ ] `npm run build` succeeds locally with production env  
- [ ] First load + deep link (e.g. `/stock`) works after hard refresh  
- [ ] `index.html` / `sw.js` not cached for months (headers)  

### Supabase

- [ ] Migrations applied to target project  
- [ ] Site URL + redirect allowlist match `VITE_APP_URL` / previews  
- [ ] Email provider configured (if using magic links / confirm signup)  
- [ ] RLS smoke-tested for member vs non-member  

### Auth flows

- [ ] Register → verify email → lands on `/auth/callback`  
- [ ] Forgot password → email → `/auth/recovery` updates password  
- [ ] Sign out clears session; local-only mode still works without env  

### PWA

- [ ] Install from browser; icon/name correct  
- [ ] Offline open shows shell; POS usable with prior data  

### Android

- [ ] `npm run build` → `cap sync` → release APK/AAB signed  
- [ ] Same Supabase project as intended env  

### Business QA

- [ ] Cashier sell flow latency acceptable on low-end device  
- [ ] Owner dashboard + alerts load  
- [ ] Backup export downloaded successfully  

---

## 11. Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Auth redirect loops / wrong host | `VITE_APP_URL` mismatch vs Supabase redirect allowlist |
| Stale UI after deploy | CDN/browser cache; SW update — hard refresh once |
| “Supabase not configured” | Missing `VITE_SUPABASE_*` in that environment’s build |
| PWA not updating | `sw.js` cache header; confirm Vercel headers apply to your path |

For database specifics, see `supabase/README.md`.
