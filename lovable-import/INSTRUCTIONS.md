# How to add your Lovable download and integrate with Waka POS

You already finished Lovable and downloaded the project from Git. Follow these steps on your PC, then we connect it to the real app in Cursor.

---

## Part 1 — Copy the Lovable folder (you do this once)

### 1. Find your folders

| What | Example path |
|------|----------------|
| **Waka POS (this repo)** | `C:\projects\pos-waka` |
| **Lovable download** | Wherever you cloned/unzipped Git (e.g. `C:\Users\Utente\Downloads\waka-admin-ui` or `C:\projects\waka-lovable`) |

The Lovable folder must contain **`package.json`** and a **`src`** folder at its root.

### 2. Open the import location

In File Explorer go to:

```
C:\projects\pos-waka\lovable-import\lovable-ui
```

If `lovable-ui` is missing, create it:

```
C:\projects\pos-waka\lovable-import\lovable-ui
```

### 3. Copy everything from Lovable **into** `lovable-ui`

Copy **all files and folders** from the Lovable project root **inside** `lovable-ui`, not beside it.

**Correct** — after copy you should see:

```
C:\projects\pos-waka\lovable-import\lovable-ui\
  package.json
  src\
  public\          (if Lovable has it)
  index.html       (if Vite)
  vite.config.ts
  tailwind.config.ts
  ...
```

**Wrong** — do not do this:

```
lovable-import\lovable-ui\some-repo-name\package.json   ❌ extra nested folder
lovable-import\package.json                             ❌ directly under lovable-import
```

If your zip has one extra folder (e.g. `waka-pos-main\`), open that folder, select **everything inside**, copy into `lovable-ui`.

### 4. Remove junk (optional but good)

Do **not** copy into `lovable-ui`:

- `node_modules` (huge; we use the main app’s install)
- `.git` (optional; not needed for import)
- `.env` with real API keys (never commit secrets)

### 5. Quick check

In PowerShell:

```powershell
dir C:\projects\pos-waka\lovable-import\lovable-ui\src
```

You should see folders like `pages`, `components`, or similar.

### 6. Fill NOTES (2 minutes)

Edit `C:\projects\pos-waka\lovable-import\NOTES.md`:

- Lovable Git URL or project name  
- What pages exist (admin, marketing, login, etc.)  
- Whether it uses **Vite** or **Next.js**

---

## Part 2 — Tell Cursor to integrate (we do this together)

Open the **`pos-waka`** project in Cursor (not only the Lovable folder).

Send a message like:

```
Integrate the Lovable UI from lovable-import/lovable-ui into the main app.
- Keep Supabase, offline sync, usePosStore, and wakaInternalAdmin.ts
- Wire admin dashboard to real APIs
- Run npm run build and fix errors
```

The agent will:

1. Read `lovable-import/lovable-ui/src`  
2. Merge admin UI into `src/pages/` and `src/components/internal-admin/`  
3. Keep routes in `src/App.tsx` pointing to the same URLs (`/internal/waka`, etc.)  
4. Replace Lovable mock hooks with `src/lib/wakaInternalAdmin.ts` and `src/lib/businessActivation.ts`  
5. Build and fix TypeScript errors  

Your **live backend** stays in this repo. Only UI/layout comes from Lovable.

---

## Part 3 — What gets merged vs what stays

| From Lovable | Into Waka POS |
|--------------|----------------|
| Admin layout, tabs, cards, tables, map UI | `src/components/internal-admin/`, admin pages |
| Marketing / auth **look** (optional) | `src/components/marketing/`, `AuthLayout.tsx` |
| Tailwind classes, colors, spacing | `src/index.css`, components |
| Lovable `package.json` dependencies | Only add missing deps to **root** `package.json` if needed |

| Stays in Waka POS (do not replace with Lovable) |
|--------------------------------------------------|
| `src/lib/wakaInternalAdmin.ts` |
| `src/lib/businessActivation.ts` |
| `src/offline/`, `src/store/usePosStore.ts` |
| `src/hooks/useAuth.ts` |
| `supabase/migrations/` |
| `.env` / Vercel env vars |

---

## Part 4 — After integration

1. Run locally: `npm run dev` in `C:\projects\pos-waka`  
2. Log in with an **internal admin** account  
3. Open **Back Office → Waka admin** or go to `/internal/waka`  
4. Test: Overview refresh, Activations approve, open a shop profile  

Deploy as usual from **`pos-waka`** root, not from `lovable-import`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `lovable-ui` is empty | Copy again; ensure `src` is inside `lovable-ui` |
| Extra folder level | Move contents up one level into `lovable-ui` |
| Lovable is Next.js | Tell Cursor in chat — integration path differs slightly |
| Admin page blank | Need Supabase + row in `waka_internal_admins` |
| Map empty | Set `VITE_MAPBOX_TOKEN` in root `.env` |

---

## Copy-paste checklist

- [ ] Lovable project copied to `C:\projects\pos-waka\lovable-import\lovable-ui\`
- [ ] `lovable-ui\src` exists  
- [ ] No `node_modules` inside `lovable-ui`  
- [ ] No real `.env` secrets in `lovable-import`  
- [ ] `NOTES.md` updated  
- [ ] Cursor opened on `C:\projects\pos-waka`  
- [ ] Sent integration message to agent  

When the checklist is done, say **“Lovable is in lovable-ui, please integrate”** and we start Part 2.

---

## Part 5 — Updating UI after more Lovable work (same process)

Lovable is **not** the live app. It is a **reference folder**. Each time you change admin UI in Lovable:

1. **Export / pull** the Lovable Git project again.
2. **Copy** changed files into `C:\projects\pos-waka\lovable-import\lovable-ui\` (same rules as Part 1 — no `node_modules`, no Lovable `supabase/`, no secrets).
3. In Cursor on **`pos-waka`**, send a focused message, for example:

```
I updated Lovable admin UI in lovable-import/lovable-ui.
Port visual changes into src/components/internal-admin/ and admin pages.
Keep wakaInternalAdmin.ts, businessActivation.ts, and supabase/ unchanged.
Run npm run build.
```

4. The agent **ports layout/classes/components** from Lovable into the main app and keeps **your APIs** (`wakaInternalAdmin.ts`, RPCs, real table names).
5. Test in the **main app** (`npm run dev`), not by running Lovable’s separate `package.json`.

### Preview mode (no Supabase admin row)

While developing, open sample-data admin UI without live RPCs:

| URL | What you see |
|-----|----------------|
| `/internal/waka?preview=1` | Overview with sample metrics |
| `/internal/waka/activations?preview=1` | Sample activation queue |
| `/internal/waka/admins?preview=1` | Sample admin list |
| `/internal/waka/shop/preview-shop-demo?preview=1` | Sample shop profile |

- **Dev:** `?preview=1` works automatically when `npm run dev`.
- **Production:** off unless you set `VITE_INTERNAL_ADMIN_PREVIEW=1` in the deploy env (not recommended for public sites).
- **Office hub:** link “Preview admin UI (sample data)” appears in dev.

Remove `?preview=1` and sign in as a real internal admin for live data.

### What does *not* auto-sync

| Lovable | Main app (you keep) |
|---------|---------------------|
| `waka_shops`, mock hooks | `shops`, `wakaInternalAdmin.ts` |
| TanStack Router files | `src/App.tsx` React Router routes |
| Lovable `supabase/` folder | `supabase/migrations/` in this repo |
| Whole `package.json` swap | Add only missing deps to root if needed |
