# Lovable import folder

Drop the **Lovable.dev** project here when the UI / admin dashboard is ready. This folder is **not** part of the production build — it is a staging area for merge work in the main app (`src/`).

**Start here:** read **[INSTRUCTIONS.md](./INSTRUCTIONS.md)** for step-by-step copy + integration.

## What to put here

Choose one approach:

### Option A — Full project copy (recommended)

Copy the whole Lovable repo into a subfolder:

```
lovable-import/
  README.md          ← this file
  lovable-ui/        ← paste the entire Lovable project root here
    package.json
    src/
    ...
```

### Option B — UI files only

If Lovable exports only front-end code:

```
lovable-import/
  README.md
  src/
    components/
    pages/
    styles/
  NOTES.md           ← optional: Lovable URL, screenshots, env vars used
```

### Option C — Git submodule or zip

- Unzip the Lovable export into `lovable-import/lovable-ui/`, or  
- Clone the Lovable repo into `lovable-import/lovable-ui/`

## Do not commit secrets

- No `.env` with real Supabase keys or Mapbox tokens  
- Use `.env.example` only, or list env names in `NOTES.md`

## After you drop files

In Cursor, ask:

> Integrate the Lovable UI from `lovable-import/`. Wire admin to `src/lib/wakaInternalAdmin.ts` and keep existing Supabase/offline POS logic.

We will:

1. Compare Lovable components with `src/components/internal-admin/`, marketing, auth layouts  
2. Port styling and layout into the real Vite app  
3. Replace mock data with `wakaInternalAdmin.ts`, `businessActivation.ts`, etc.  
4. Run `npm run build` and fix types

## What Lovable should have built

- Internal admin: `/internal/waka`, `/activations`, `/admins`, `/shop/:shopId`  
- Marketing + auth screens (optional in same import)  
- Waka Technologies branding (orange `#ea580c`), mobile-first  
- **Mock data only** — backend stays in this repo

## Reference docs in this repo

- Admin feature list: ask in chat for “admin dashboard spec” or see conversation history  
- Production admin code today: `src/pages/InternalWakaAdminPage.tsx`, `src/components/internal-admin/`, `src/lib/wakaInternalAdmin.ts`

## Folder status

| Path | Purpose |
|------|---------|
| `lovable-import/lovable-ui/` | **Put your Lovable project here** (create when you copy files) |
| `lovable-import/NOTES.md` | Optional: links, screenshots, decisions |
| `lovable-import/.gitkeep` | Keeps folder in git until you add the import |
