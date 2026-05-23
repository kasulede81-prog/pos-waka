# Lovable import notes

Reference UI lives in `lovable-import/lovable-ui/` (from `waka-safari-shop-main`). **Integrated into main app** — do not copy Lovable `supabase/` or replace `src/lib/wakaInternalAdmin.ts`.

## Integrated (main app)

| Lovable reference | Main app |
|-------------------|----------|
| `waka-admin-shell.tsx` | `src/components/internal-admin/WakaAdminShell.tsx` |
| `field-map.tsx` | `src/components/internal-admin/LovableFieldMap.tsx` (overview when `lovableUi`) |
| Hero / shortcuts / cards | `src/components/internal-admin/adminUi.tsx` |
| `internal.waka*.tsx` routes | Existing React Router: `/internal/waka`, `/activations`, `/admins`, `/shop/:shopId` |

**Data layer (unchanged):** `wakaInternalAdmin.ts`, `businessActivation.ts`, existing Supabase migrations under `supabase/`.

**Pages using shell + Lovable styling:**

- `InternalWakaAdminPage` — overview, activations, admins
- `InternalShopOpsPage` — shop profile inside `WakaAdminShell` (`active="shop"`)
- `InternalOpsDashboard` — `lovableUi` hero, shortcuts, simple map
- `InternalActivationOpsPage` / `InternalAdminsManagement` — `lovableUi` stone cards

## Lovable project (reference)

- **Stack:** TanStack Start/Router, shadcn, Tailwind v4, mock table names (`waka_shops`, etc.)
- **Not ported wholesale:** TanStack Router, Radix/shadcn deps, Lovable Supabase client

## Env

Map (optional): `VITE_MAPBOX_TOKEN` or `VITE_MAPBOX_ACCESS_TOKEN`

## Preview mode

- URLs: `/internal/waka?preview=1` (+ activations, admins, `shop/preview-shop-demo`)
- Data: `src/lib/internalAdminPreview.ts` (sample rows; mutations blocked)
- Dev-only unless `VITE_INTERNAL_ADMIN_PREVIEW=1`

## Lovable UI updates (repeatable)

1. Refresh files under `lovable-import/lovable-ui/`
2. Ask Cursor to port **visual** changes into `src/components/internal-admin/` + pages
3. Do **not** replace `wakaInternalAdmin.ts` or `supabase/`
4. `npm run build` in repo root

## Remaining gaps vs Lovable mock

- [ ] Full metric grid parity on overview (Lovable had lighter metrics; main app keeps full ops dashboard)
- [ ] Shop page: Lovable used direct `waka_*` tables; main app uses `fetchShopOpsDetail` RPCs (richer)
- [ ] Role-based UI polish on shop actions (partially implemented via existing role checks)

## Integration checklist

- [x] Files in `lovable-import/lovable-ui/`
- [x] Shell + admin UI wired to `wakaInternalAdmin.ts`
- [x] `npm run build` passes
