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
