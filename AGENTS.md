# AGENTS.md

## Cursor Cloud specific instructions

Waka POS is a single React 19 + TypeScript SPA (Vite 8) — an offline-first point-of-sale for Uganda shops. The same `src/` build is also wrapped by Capacitor (`android/`) and Electron (`electron/`), but the web/PWA dev server is all you need for local development. Standard commands live in `README.md` and `package.json` `scripts`.

### Running the app (local-only mode)
- `npm run dev` serves the web app on `http://localhost:5173` (Vite). Use `npm run dev -- --host 127.0.0.1 --port 5173` if you need to pin the bind address.
- The app is **offline-first**: with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` unset, `src/lib/supabase.ts` makes the Supabase client `null` and the app runs entirely on browser IndexedDB (`auth.mode === "local"`). No backend, account, or secrets are required to run and test the core POS (sign-in, onboarding, products, sales, reports).
- In local mode the `/login` form is not real auth: any email + any password ≥ 4 chars creates a local session (`waka-pos-local-session` in localStorage) and proceeds to the onboarding wizard. There is no registration in local mode — sign up requires Supabase.
- Cloud features (real auth, multi-device sync, internal Waka admin, billing, AI, Mapbox) need a Supabase project + the `VITE_*` env vars (see `.env.example`) and the SQL in `supabase/migrations/`; these are optional and not needed for offline POS testing.

### Lint caveat (non-obvious)
- `npm run lint` runs `eslint .`, which **fails** because ESLint 10 resolves the nested config `lovable-import/lovable-ui/eslint.config.js` (it imports `eslint-plugin-prettier`, not installed at the repo root). `lovable-import/` is a **reference-only** staging folder excluded from the build (`.vercelignore`) and from Vite. Lint the actual product with `npx eslint src` instead.
- Pre-existing state (committed code, not an env issue): `npx eslint src` reports lint errors, and `npm run test` (Vitest) has a small number of failing tests (~18 of ~970). These are not caused by environment setup.

### Tests / build
- `npm run test` → Vitest (`vitest run`), node environment, no external services required.
- `npm run build` → `tsc -b && vite build` (production). For dev, prefer `npm run dev`.
