# HOME-DENSITY-1.2 — FIRST-SCREEN HIERARCHY FORENSIC CERTIFICATION

Date: 2026-08-19  
Mode: **FORENSIC AUDIT ONLY** (no source, CSS, Settings, POS, checkout, sync, auth, or database changes)  
Baseline: HOME-DENSITY-1.0 + implemented HOME-DENSITY-1.1 (`max-w-7xl`, no grid stretch, footer follows content)

**Physical-device measurement was not performed.** Heights below are **CSS-derived approximations**. Rows marked **device** need Safari / Capacitor / Electron confirmation.

---

## 1. Executive verdict

**NO-GO to leave the current first-screen order unchanged.**  
**GO to implement a single, shared-tree reorder — not a redesign, not a second Home page, not deleting KPI/Health/Reports.**

HD-01/03/05 are addressed. **HD-02 remains:** for an **owner/manager with a full module set**, the first viewport is an executive briefing (greeting → Sell → KPI → Health → Reports). **Primary work tiles are not reliably on screen** at phone portrait or 1280×720. That is a hierarchy problem, not leftover padding.

Cashiers and shops with few modules are much closer to fine: they have fewer KPIs, no Reports card, and often already see Inventory on the first phone screen.

**Do not remove** greeting, Sell, KPI, Health, or Reports. All are content-bearing. The 1.2 job is **order and, on large screens, packing** so Primary is reachable without throwing away the morning scan.

**Single recommended implementation path:** see §25.

---

## 2. Score /100 (first-screen hierarchy only)

| Category | Score | Notes |
|---|---:|---|
| Owner phone first screen | **34** | KPI + Health consume the fold; Primary off-screen |
| Owner 1280×720 first screen | **48** | Reports finishes the fold; Primary clipped or absent |
| Owner Electron 1440×900 | **72** | Primary first row typically fits after 1.1 |
| Owner 1920×1080 | **86** | Primary + start of Operations |
| Cashier phone first screen | **74** | Thin KPI; no Reports; Inventory often visible |
| Tablet 768 portrait | **45** | Same 2-col stack as phone; executive chrome still first |
| Tablet 1024×768 landscape | **42** | KPI becomes 2 rows; worse than 1280×720 |
| Information preservation | **90** | Stack is useful; nothing is empty chrome |
| Settings honesty risk if reordered | **70** | Preview must share the same order tokens |
| Constraint fit (Sell/Reports/no second page) | **88** | A CSS/`order` solution fits |
| **OVERALL (HD-02)** | **58 / 100** | **Not certified until Primary is on the first screen for owner at 390 and 720p** |

---

## 3. Current composition (code, post-1.1)

Hard-coded in `DesktopHomeTiles` (live) and mirrored in `HomeMenuArrangePanel` (Settings):

```
AppShell header          (not in page; shrink-0)
DesktopHomePage gutter   py-4 / sm:py-6
  Greeting
  HomeBusinessHero       Sell locked
  HomeExecutiveKpiStrip  null if kpis.length === 0
  HomeBusinessHealthSection
  HomeReportsPreview     if reports tile visible
  Primary work           inventory, cash, cashPosition [, pharmacy dashboard]
  Operations
  Admin
DesktopLicenseBar        after content (1.1)
```

There is **one component tree** for all viewports. No mobile-only Home. `presentHomeMenuTiles()` assigns bands; **it does not assign first-screen order** — JSX order is the order.

---

## 4. Height model (CSS-derived)

**Scrollport** ≈ `100dvh` − AppShell header.

| Header | Formula | Typical |
|---|---|---|
| Desktop / Electron | `pt-2` + `pb-2` + `min-h-[38px]` row, no notch | **~54px** |
| iPhone Capacitor | `pt-[max(0.5rem,safe-top)]` + row + `pb-2` | **~90–100px** (notch ~47) |
| iPhone Safari | plus browser chrome | **device** (smaller scrollport) |

**Block estimates** (owner, English, liveStat present):

| Block | &lt;640 stacked | ≥640 (`sm`) | ≥1024 (`lg`) | ≥1280 (`xl`) |
|---|---:|---:|---:|---:|
| Page pad top | 16 | 24 | 24 | 24 |
| Greeting + mb | ~60 | ~64 | ~64 | ~64 |
| Sell hero + mb | **~160** (CTA stacked) | **~118** (CTA beside copy) | ~118 | ~118 |
| KPI title + cards + mb | **~296** (6 KPIs, 3×72 rows) | ~296 (still 2-col) | **~222** (3-col, 2 rows) | **~140** (6-col, 1 row) |
| Health card + mb | **~240** (2-col chips) | ~200 (3-col) | **~148** (6-col, 1 row) | ~148 |
| Reports + mb | **~148** (min 88 + liveStat) | ~150 | ~150 | ~150 |
| Primary title + 1 row tiles | ~140 (2-col, 112px cards) | ~140 | ~140 (3-col) | ~140 (4-col, 3 tiles = 1 row) |

KPI strip **unmounts** when empty. Health always mounts (connectivity / sync / subscription at minimum).

---

## 5. First viewport — what is on screen

Legend: **yes** = fully in first scrollport; **clip** = starts in view, incomplete; **no** = below the fold. Owner = default catalog, all perms, 6 executive KPIs, Reports visible, 3 Primary tiles.

### Owner

| Viewport | Available (approx) | Greeting | Sell | KPI | Health | Reports | Primary |
|---|---:|---|---|---|---|---|---|
| 390×844 | ~750 (Capacitor) | yes | yes | clip / most | clip / no | **no** | **no** |
| 430×932 | ~840 | yes | yes | yes/clip | clip | **no** | **no** |
| 768×1024 | ~960 | yes | yes | yes | clip/yes | clip | **no** |
| 1024×768 | ~714 | yes | yes | yes (2 rows) | yes | clip | **no** |
| 1280×720 | ~666 | yes | yes | yes (1 row) | yes | yes/clip | **no / title clip** |
| 1440×900 Electron | ~846 | yes | yes | yes | yes | yes | **yes (1 row)** |
| 1920×1080 | ~1026 | yes | yes | yes | yes | yes | **yes** + Operations start |

**390 / 720p are the HD-02 failures.** 900p/1080p are acceptable after 1.1.

Safari 390 is **worse** than Capacitor if browser chrome is visible (**device**).

### Cashier (typical)

Tiles: Sell, Inventory (primary), Debts + Sales history (operations). **No Reports.** Executive KPIs: today revenue + transactions (**1 row**, ~136px). Health: no risks chip; stock chip if `stock.view`.

| Viewport | Primary Inventory |
|---|---|
| 390×844 | **Likely yes** (budget ~540 before Primary; tile ~140) |
| 1280×720 | **yes** (thin stack) |

HD-02 is **not** a cashier-first problem.

### Manager

Same first-screen chrome as owner (shop-wide KPIs, Reports, cash tiles). No Command Center (`owner.dashboard`). **Same fold failure as owner** at 390 and 720p.

### Few modules (hidden cash/reports)

Stack shrinks; Primary can appear. **Do not use this as the design target** — owners with defaults are the product.

### Many modules

Extra Primary tiles add a **second 112px row** on phone (`grid-cols-2`). If Primary is moved up, two rows (~234px) still fit after a compact hero; they do **not** fit after the current KPI+Health stack.

---

## 6. Role / permission map (why stacks differ)

| Region | Owner | Manager | Cashier |
|---|---|---|---|
| Sell hero | yes | yes | yes |
| KPI count | up to 6 | up to 6 | **1–2** (personal) |
| Health | full (incl. risks) | risks if `owner.activity` | no risks; stock yes |
| Reports card | yes (`reports.view`) | yes | **no** |
| Primary tiles | inventory, cash, cashPosition | same | **inventory only** |
| Operations | debts, history, shop, profit | similar | debts, history |

`resolveVisibleHomeMetrics`: owner/manager/supervisor = shop-wide; cashier/waiter = personal; stock_keeper = inventory KPIs only, no Sell revenue.

---

## 7. Option comparison (not implemented)

Hard constraints: Sell locked hero; Reports stays a **component** (may move); no gradients; no &lt;48px primary targets; no second Home page unless unavoidable; Settings preview structurally honest; no POS/checkout/sync/auth/DB.

| Option | 390 owner Primary | 720p owner Primary | Keeps KPI/Health/Reports | Settings honest | Risk |
|---|---|---|---|---|---|
| **A.** Sell + Primary, then KPI/Health, Reports last of scan | **yes** | **yes** if Reports also after Primary | yes, later | yes if same JSX/`order` | Owners lose above-the-fold numbers on **desktop too** |
| **B.** Sell + compact KPI row + Primary | partial (KPI still ~140–296) | yes if Health compacted | yes | yes | Phone 3-row KPI still blocks unless KPI is horizontally compacted (touch risk) |
| **C.** KPI/Health below Primary (all breakpoints) | **yes** | **yes** | yes | yes | Phase 34.1 desktop morning scan gone |
| **D.** Desktop side-by-side KPI \| Health | no change on phone | **borderline / yes** with Reports after Primary | yes | preview follows `lg` | Phone HD-02 remains if D is the only change |
| **E.** Mobile-specific **order**, same tree (`order-*` / `lg:order-*`) | **yes** | depends on lg order | yes | **honest per viewport** | Desktop Settings preview ≠ phone order (correct if live does the same) |
| **F.** Reports after Primary, still dedicated | not enough on phone | **yes** (~150px saved; Primary fits 720p) | yes | yes | Phone still blocked by KPI+Health |

**None of A–F alone is enough** except a **combination of E + F** (and optionally D).

---

## 8. What must not be dropped

| Block | Keep? | Why |
|---|---|---|
| Greeting | keep | Cheap (~60px); identity |
| Sell hero | **keep first** | Locked primary action; 48px CTA |
| KPI strip | **keep** | Phase 34.1 scan; unmounts when empty — do not delete math |
| Health | **keep** | Sync/offline/stock/subscription; not decorative |
| Reports component | **keep dedicated** | May move below Primary; do not merge into grid |
| Primary tiles | **raise on first screen** | This is the 1.2 goal |
| Operations / Admin | stay below | Correct |

---

## 9. Settings integration

`HomeMenuArrangePanel` copies live section order today. If live Home uses responsive `order`, Settings **must use the same classes/tokens** so:

- Phone Settings preview = phone Home
- Desktop Settings preview = desktop Home

Do **not** invent a Settings-only order. Do **not** split a second mobile Home route.

`presentHomeMenuTiles()` can stay as band membership. Add a **shared region list** or documented `order` utilities consumed by both live and Settings.

---

## 10. Accessibility / touch

Reordering with flex/grid `order` does not shrink targets. Watch **tab order vs visual order**: `order` can desync keyboard sequence from the screen. Implementation must set DOM order to the **mobile sequence** (hero → primary → …) and use `lg:order-*` only if focus order is tested — **or** change JSX order with a `matchMedia('lg')` shared helper so DOM matches visuals. Prefer **one DOM order that matches the smaller screen**, then CSS pack for `lg+`, and test desktop keyboard.

Do not shrink `min-h-[112px]` / Sell `48px` / health `44px`.

---

## 11. Findings

| ID | Sev | Finding |
|---|---|---|
| **HD-02** | **P1** | Owner/manager first screen is briefing, not modules, at 390 and 1280×720. |
| **HD-02a** | **P1** | Phone: KPI 3-row + Health 2–3-row after stacked hero ≈ 450px+ before Reports/Primary. |
| **HD-02b** | **P1** | 1024×768: `lg:grid-cols-3` makes **two** KPI rows — worse than 1280×720’s one row. |
| **HD-02c** | **P2** | Reports above Primary costs ~150px; at 720p that is the difference between seeing Primary and not. |
| **HD-02d** | Info | Cashier / few-module shops already see Primary on phone — do not optimize only for them. |
| **HD-02e** | **P2** | Phase 34.1 wanted KPI/Health above the fold on **desktop**. Mobile-first POS needs modules first. **Breakpoint-specific order is justified.** |
| **HD-02f** | **P3** | Greeting is small; not the villain. |

No P0 (nothing broken). No justification for a second mobile Home page.

---

## 12–24. Audit answers (condensed)

**Desktop / Electron:** 1440×900 and 1080p already show Primary after 1.1. 1280×720 does not. Side-by-side KPI\|Health is optional slack, not sufficient alone.

**Mobile:** Capacitor 390/430 fail for owners. Same tree; `hidden sm:block` hero preview does not reserve space (1.0/1.1).

**Tablet:** 768 behaves like a large phone (2-col KPI). 1024×768 landscape is a **hot spot** (short + 2-row KPI).

**iOS / Android / Capacitor:** Inset/header only changes the budget by ~40–50px; not the ordering diagnosis. Safari chrome is **device**.

**Display Scale:** Still Sell-only; irrelevant to first-screen order.

**Localization:** `line-clamp-2` can add one tile row; does not change the KPI/Health blocking math.

**Performance:** Reorder is CSS/DOM; no extra KPI queries.

**Debug overlay:** Dev-only; ignore for fold.

---

## 25. Single recommended implementation path

### HOME-DENSITY-1.2 implementation (next phase, not this audit)

**Name:** Shared-tree first-screen order: modules early on small screens; executive scan stays after Sell on `lg+`; Reports stays dedicated but **after Primary**.

**Do this:**

1. **All breakpoints — move `HomeReportsPreview` to after the Primary section** (still its own component, still Settings-selectable). This is F. It makes **1280×720 owner Primary fit** (~150px recovered).

2. **Below `lg` (phone + tablet portrait) — visual order:**  
   `Greeting → Sell → Primary → Reports → KPI → Health → Operations → Admin`  
   This is E. Owner 390 then sees Sell + Inventory/Cash tiles before the KPI wall.

3. **`lg+` (desktop, Electron, landscape tablet) — visual order:**  
   `Greeting → Sell → KPI → Health → Primary → Reports → Operations → Admin`  
   Preserves Phase 34.1 morning scan where the viewport can afford it (900p/1080p already good; 720p works because of (1)).

4. **Optional same-phase if 1024×768 still clips Primary:** wrap KPI + Health in a **2-column row at `lg` only** (option D). Do not compact KPI into a horizontal scroller on phone.

5. **Settings:** same region order utilities as live Home. No second preview implementation.

6. **DOM vs `order`:** prefer a small shared layout helper or CSS that is tested for keyboard/focus; do not ship visual order that skips tiles when tabbing.

**Do not:**

- Delete or gate KPI/Health off Home
- Merge Reports into `LivingDashboardCard`
- Unlock/recolor Sell
- Restore `HomeLauncherTile` / gradients
- Add `HomePage.mobile.tsx`
- Shrink tile min-heights
- Touch POS, checkout, sync, auth, RLS, migrations
- Drive this with Display Scale

**Success criteria:**

- Owner at **390×844**: at least one Primary tile fully tappable without scrolling (typically Inventory).
- Owner at **1280×720**: at least one full Primary row visible.
- Cashier: no regression (still sees Sell + Inventory).
- Electron 1440: Primary still visible; KPI/Health still above Primary.
- Settings preview section order matches live at that viewport.
- Reports remains `HomeReportsPreview`.

**Later (1.3+), only if needed:** tablet `md` column policy; overlapping KPI vs tile `liveStat` (product, not CSS).

---

## Production deployment

NONE (audit only).
