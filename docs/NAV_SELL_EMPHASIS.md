# Bottom navigation — Sell button emphasis

## 1. Current hierarchy analysis (before)

| Tab | Inactive | Active | Problem |
|-----|----------|--------|---------|
| Home | Gray text, small icon | **Solid orange** | Competes with Sell |
| Sell | Gray + thin orange ring | **Solid orange** | Weak when not on Sell |
| Sales History | Gray | **Solid orange** | Same weight as Sell |
| Back Office | Gray | **Solid orange** | **Dominates** on office screens (see screenshot) |

**Root cause:** All tabs used `active ? "bg-waka-600 text-white"` — whichever screen you are on looked like the “primary” action. Sell only had a subtle ring when inactive, so **Back Office / Home won** whenever the user was not on `/pos`.

**Platforms:** Same `AppShell` footer on Android WebView, iOS Safari, and mobile browser (fixed bottom nav, `lg:hidden`).

---

## 2. Proposed redesign (implemented)

**Option A (light):** Raised center **Sell** — always solid orange; other tabs use muted active state.

| Priority | Tab | Inactive | Active |
|----------|-----|----------|--------|
| 1 | **Sell** | Orange circle, elevated, large icon | Darker orange + ring |
| 2 | Sales History | Stone gray | Light gray + waka text |
| 3 | Home | Stone gray | Light gray + waka text |
| 4 | Back Office | Stone gray | Light gray + waka text |

**Mobile order:** `Home · Sales History · [Sell] · Back Office` (Sell centered, `-mt-3` lift).

**Unchanged:** Routes, permissions, `navItemActive`, desktop sidebar.

---

## 3. Mobile mockup (after)

```
┌─────────────────────────────────────────────┐
│  … page content …                           │
├─────────────────────────────────────────────┤
│  Home    History      ╭───────╮    Office   │
│  ⌂       🧾           │ 🛒    │    💼      │
│                       │ Sell  │            │
│                       ╰───────╯            │
│         (gray)      (ORANGE FAB)   (gray)  │
└─────────────────────────────────────────────┘
```

Sell: `rounded-full`, `bg-waka-600`, shadow, 52–56px touch target.  
Others: `text-stone-500`; active = `bg-stone-100` (not orange).

---

## 4. Before vs after

| Aspect | Before | After |
|--------|--------|-------|
| Primary signal | “Current tab” (orange) | **Always Sell** (orange FAB) |
| On Back Office | Office tab = orange | Office = light gray; Sell still orange |
| Icon size Sell | Slightly larger | **Clearly larger** (28–32px) |
| Footer height | 4.25rem | 4.5rem (minimal bump for lift) |
| Clutter | Equal-weight tabs | One hero control |

---

## Files

- `src/components/layout/AppShell.tsx` — mobile nav layout + styles
- `src/index.css` — `--waka-bottom-nav-h`
