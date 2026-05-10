# Waka POS

Offline-first point of sale for Uganda shops: fast kiosk selling, owner back office, local IndexedDB storage, optional Supabase sync.

## Quick start

```bash
npm install
cp .env.development.example .env.development.local
# Edit .env.development.local with your Supabase anon URL + key (or leave unset for local-only mode)
npm run dev
```

## Deploy & production

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for:

- Vercel (SPA routing, caching, PWA)
- Development / staging / production env files
- Supabase auth redirect URLs
- Android (Capacitor) release flow
- Offline verification checklist
- Security (RLS, keys) and monitoring hooks

## Scripts

| Command | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server (`development` mode) |
| `npm run dev:staging` | Dev server with `staging` env |
| `npm run build` | Production build |
| `npm run build:staging` | Staging build |
| `npm run cap:sync` | Copy web build into Android (run `npm run build` first) |

## Repo layout

- `src/` — React app, offline DB, sync queue
- `supabase/migrations/` — SQL migrations (run via Supabase CLI or dashboard)
- `android/` — Capacitor Android shell (`README-RELEASE.md` for signed APK)
