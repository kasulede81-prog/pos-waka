# Phase 34.0 — Enterprise Home Dashboard, Executive Workspace & First-Run Experience Certification

**Mode:** Read-only enterprise UX audit (**NO code changes, NO CSS changes, NO component changes, NO database/API changes**)  
**Date:** 2026-08-04  
**Scope:** Post-login **Home workspace** (`/` → `HomePage` → `DesktopHomePage`) as the primary surface users see after authentication  
**Out of scope:** Re-auditing Sell / Inventory engines (except Home dependency); public marketing `/home`  
**Related prior work:**  
- Phase 22.x / 29.x — design system & visual language (Home noted as gradient/theme debt)  
- Phase 24.x — performance (`useHomeDashboardMetrics`, launcher paths)  
- Phase 30.0 — desktop workspace (Home classified as **tile launcher**)  
- Phase 32–33 — Sell cashier certification (separate module)  

**Core question:**

> Does Home feel like the **command center of the business**, or merely a **launcher of modules**?

---

## Executive Summary

Post-login Home is a **permission-gated living tile launcher** with a strong brand/identity hero (`HomeBusinessHero` + `BusinessBuilderScene`), saturated module gradients (`homeDashboardTheme` + `LivingDashboardCard`), and footer status chips. It is **not** an enterprise executive dashboard.

The product already has a real executive workspace — **Command Center** at `/owner` (`OwnerDashboardPage` → `EnterpriseDashboardShell`) — with health hero, `CommandCenterKpiGrid`, attention, quick actions, devices, and integrity. That surface is **permission-gated and secondary**; it is not what most roles see first after login.

| Persona | What Home delivers today | Gap |
|---------|--------------------------|-----|
| Cashier | Sell hero CTA + limited personal tiles | Acceptable as launcher; weak “today’s priorities” |
| Owner / Manager | Colorful module grid + footer sync/risk chips | **Missing** morning KPI scan & health command strip |
| Multi-branch | Launcher only | Executive multi-branch lives at `/enterprise` (separate) |
| Pharmacy | Dispense CTA + ops badges on tiles | Ops dashboard at `/pharmacy` is separate |
| Hospitality | Often **skips Home** → `/floor` (`terminalHome`) | Home not the daily workspace |

**Overall certification status: NOT CERTIFIED as an enterprise executive workspace.**

**Freeze recommendation:** Do **not** freeze Home as “done.” Phase 34.1 should reconcile **launcher speed** with **executive decision support** (hierarchy + health + KPIs) without changing business logic — preferably by elevating existing Command Center primitives onto Home or clearly promoting Command Center as the owner’s morning landing.

---

## Score Table

| Category | Score | Verdict |
|----------|------:|---------|
| First Impression | **6.2** | Warm greeting; business status not immediate |
| Executive Dashboard | **4.4** | Launcher, not command center |
| Information Hierarchy | **5.0** | Fragmented; health buried in footer |
| KPI Visibility | **5.3** | Live stats on tiles; no primary KPI strip |
| Module Cards | **5.7** | Consistent cards; equal visual shouting |
| Business Health | **4.1** | Footer chips only; no dedicated health area |
| Reports | **5.2** | Featured tile; no executive preview |
| Desktop | **6.4** | Grid scales; still stretched launcher |
| Tablet | **6.1** | Intermediate columns; hero still heavy |
| Mobile | **5.8** | Tall hero; modules/health below fold |
| Design System | **3.6** | Zero `Enterprise*` primitives on Home |
| Accessibility | **5.6** | Nav labels + focus; emoji chips; motion pause |
| **Overall** | **5.3 / 10** | **Not certified** |

---

## Certification Methodology

1. Static forensics of `HomePage`, `DesktopHomePage`, `DesktopHomeTiles`, `HomeBusinessHero`, `LivingDashboardCard`, footer chips/banners.  
2. Theme/catalog: `homeDashboardTheme.ts`, `launcherTiles.ts`, `homeVisibility.ts`, `useHomeDashboardMetrics`.  
3. Contrast with Command Center (`EnterpriseDashboardShell`, health/KPI/quick-actions).  
4. Role/scope rules in `homeVisibility` + hospitality redirect in `terminalHome`.  
5. First-run: `OnboardingRouteGate` (pre-Home) — no coachmarks **on** Home.  
6. Prior docs (Phases 22/24/29/30) for known Home debt.  
7. Enterprise dashboard benchmarks as **quality references only** (no layout cloning).

**Not performed:** Live user testing; timed eye-tracking; screenshot OCR of a specific shop.

---

## Architecture Map (evidence)

```
/  → HomePage → resolveTerminalHomePath
                 ├─ hospitality + floor perm → /floor
                 └─ else DesktopHomePage
                      ├── header (greeting + shop · sub)
                      ├── DesktopHomeTiles
                      │   ├── HomeBusinessHero (scene + sell/dispense CTA + today txn)
                      │   ├── profit LivingDashboardCard (heroSecondary)
                      │   ├── scene grid (2→3→4→5 cols)
                      │   └── reports LivingDashboardCard (featured)
                      └── footer
                          ├── DesktopStatusChips (risk / low stock / sync)
                          ├── DesktopSubscriptionBanner
                          └── DesktopLicenseBar

/owner → OwnerDashboardPage → EnterpriseDashboardShell
         (health · KPIs · attention · cash · inventory · quick-actions · …)
```

| File | Role |
|------|------|
| `src/pages/HomePage.tsx` | Route entry + terminal redirect |
| `src/pages/DesktopHomePage.tsx` | Greeting + tiles + footer |
| `src/components/home/DesktopHomeTiles.tsx` | Hero + tile composition |
| `src/components/home/HomeBusinessHero.tsx` | Identity / Sell CTA |
| `src/components/home/LivingDashboardCard.tsx` | Module cards |
| `src/config/homeDashboardTheme.ts` | Gradients / glow / Lottie ids |
| `src/lib/launcherTiles.ts` | Catalog + permissions |
| `src/lib/homeVisibility.ts` | Role metric scope |
| `src/hooks/useHomeDashboardMetrics.ts` | Per-tile live stats |
| `src/components/command-center/*` | True executive workspace |

**No prior `PHASE_*HOME*` certification document exists.**

---

# PART 1 — Executive First Impression

### 5-second read (code structure)

1. Time-based greeting + first name (`desktopHomeGreetingMorning|Afternoon|Evening`).  
2. Shop name · generic subcopy.  
3. Large **Business Builder** preview (Open badge, live dot) + Sell/Dispense CTA.  
4. Saturated gradient tiles compete for attention.  
5. Business health (sync / risks / low stock) appears only after scrolling to the **footer**.

| Signal | Present in first viewport? |
|--------|----------------------------|
| Business status (healthy / at risk) | **Weak** — Open badge ≠ ops health |
| Today’s priorities | **Weak** — one sell txn liveStat if permitted |
| Where to act first | **Strong for Sell** — primary CTA |
| Cash / profit / debts overview | **No** as a scan strip |

**Cognitive load:** High visual richness (scene + Lottie + gradients + spotlight rotation) vs low executive density.

**First Impression: 6.2 / 10** — friendly and branded; not executive-confident.

---

# PART 2 — Information Architecture

### Desired executive flow (audit question)

```
Greeting → Business KPIs → Quick Actions → Modules → Health → Reports → Activity
```

### Actual Home flow

```
Greeting → Identity Hero (scene) → Profit tile (optional) → Module scene grid → Reports featured tile
         → [scroll] Footer chips (health) → Subscription → License
```

| Desired block | On Home? | Notes |
|---------------|----------|-------|
| Greeting | Yes | Compact header |
| Business KPIs | Partial | Embedded on tiles as `liveStat`, not a KPI band |
| Quick Actions | **No** | Exists on Command Center only |
| Business Modules | Yes | Primary content |
| Health | Footer only | Competing with license chrome |
| Reports | Featured tile | No chart/table preview |
| Activity | **No** | Investigation is a tile; no feed |

**Fragmentation:** Health and subscription compete at the bottom; profit is elevated while Command Center (the real executive hub) is one equally loud scene tile; Reports is featured but still a navigation card.

**Duplication / competition:**  
- Risk signals appear as tile badges **and** footer chips.  
- Low stock on inventory badge **and** footer chip.  
- Sell appears as hero CTA; no separate sell tile in grid (correct) but identity scene occupies KPI-grade space.

**Information Hierarchy: 5.0 / 10**

---

# PART 3 — Hero Section

| Element | Implementation |
|---------|----------------|
| Greeting | Above hero in page header |
| Shop identity | `BusinessBuilderScene` + shop label from builder |
| Today’s overview | Optional `sellStat` (txn count) |
| Primary CTA | Full-width Sell / Dispense (`min-h-[52–56px]`) |
| Vertical cost | Preview `max-h-[min(38vh,260px)]` on small; tall on `lg` row |

**Excessive vertical space:** **Yes on mobile/tablet** — builder preview + copy + CTA commonly push module KPIs and health below the fold. On desktop, side-by-side (`lg:flex-row`) reduces but does not eliminate the cost.

**Valuable info below the fold:** Footer health chips; many module live stats; reports featured card on shorter viewports.

**Hero verdict:** Strong for **first-run emotional ownership** (“the shop you built”). Weak for **daily executive scan**. Phase 34.1 should treat this as an identity block that must not displace KPIs/health — not as a redesign request in this phase.

---

# PART 4 — KPI Hierarchy

### Metrics available via `useHomeDashboardMetrics` (tile-attached)

| KPI | Placement | Visibility gate |
|-----|-----------|-----------------|
| Today transactions | Hero sellStat / salesHistory tile | shop-wide or personal revenue roles |
| Month profit + trend | Profit tile (`heroSecondary`) | `resolveProfitVisibility` |
| Low stock count | Inventory tile + footer | inventory roles |
| Expected drawer cash | Cash / cashPosition tiles | `day.close` |
| Today revenue | Command Center tile | `owner.dashboard` |
| Total debt | Debts tile | shop-wide debt |
| Month sales + trend | Reports tile | shop-wide revenue |
| Sync / subscription / devices | Footer license / chips — **not KPIs** | always / gated |

### Not on Home as primary KPIs

Customers · devices online/stale · subscription as metric card · sync health score · integrity — these appear on **Command Center**.

| Tier | Should be primary (executive) | Current |
|------|-------------------------------|---------|
| Primary | Today sales, cash position, alerts/health | Buried / tile-secondary |
| Secondary | Profit, debts, low stock | Mixed (profit elevated; others scene) |
| Tertiary | Devices, subscription detail, settings | Footer / settings tile |

**Scan speed:** Slow — user must parse art-heavy cards to find numbers. Numbers are present but visually secondary to gradients/Lottie.

**KPI Visibility: 5.3 / 10**

---

# PART 5 — Module Cards

Catalog-driven `LivingDashboardCard` tiles (examples): Inventory, Debts, Cash Drawer, Cash Position, Command Center, Investigation, Sales History, Back Office (`shop`), Reports, Settings, Pharmacy dashboard, Marketing agent.

| Criterion | Finding |
|-----------|---------|
| Hierarchy | Profit + Reports slightly elevated; others equal scene grid |
| Typography | Bold titles; subtitles from theme keys |
| Density | Low–medium — art/Lottie consume space; one liveStat |
| Icons / art | Heavy illustration language |
| CTA visibility | Chevron / arrow affordance; whole card is CTA |
| Consistency | Strong within Living system |
| Visual priority | **Every scene card shouts** via unique saturated gradient |

**Equal competition:** Yes — fuchsia inventory, sky cash, rose investigation, indigo command center, etc. No calm enterprise “module shelf.”

**Module Cards: 5.7 / 10**

---

# PART 6 — Color Strategy

Evidence: `homeDashboardTheme.ts` assigns per-tile `from-*-500 via-*-600 to-*-900` gradients + colored glows/shadows. `LivingDashboardCard` adds spotlight glow and hover lift.

| Question | Answer |
|----------|--------|
| Every card shouting? | **Yes** |
| Colors communicate meaning? | Partially (rose≈risk, emerald≈profit) but mostly decorative |
| Accent overuse? | **Yes** — brand orange + many competing hues |
| Status colors reserved? | Footer uses success/danger correctly; tiles do not reserve status semantics |
| Soften toward unified identity? | **Recommended for Phase 34.1** (presentation) — align with Phase 29 “enterprise calm” |

---

# PART 7 — Executive Workflow

### Morning

| Step | Ideal | Home today | Clicks |
|------|-------|------------|--------|
| Business status | Health strip | Footer sync/risk (scroll) | 0–1 scroll |
| Alerts | Attention list | Chips / badges | 1 |
| Start selling | Primary CTA | Hero Sell | **1** |

### Midday

| Step | Ideal | Home today | Clicks |
|------|-------|------------|--------|
| Monitor sales | KPI strip | Tile liveStat or → Reports/CC | 1–2 |
| Inventory | Module | Inventory tile | 1 |
| Cash | Module | Cash tile | 1 |

### Closing

| Step | Ideal | Home today | Clicks |
|------|-------|------------|--------|
| Cash drawer | Quick action | Cash tile | 1 |
| Reports | Preview + deep link | Featured tile | 1 |
| Sync | Health area | Footer chip → backup | 1–2 |
| EOD review | Command Center | Command Center tile (if permitted) | 1 |

**Cashier morning path is efficient.** Owner/manager morning path requires **leaving Home** (or scrolling past art) to feel in control — Command Center is the missing first stop.

**Executive Dashboard: 4.4 / 10**

---

# PART 8 — Business Health

| Signal | Home location | Dedicated area? |
|--------|---------------|-----------------|
| Sync | Footer chip → `/office/backup` | No |
| Risks | Footer chip + investigation/CC badges | No |
| Low stock | Footer chip + inventory badge | No |
| Subscription | Banner + license bar | Footer chrome |
| Device status | Device **limit** text in license bar | No online/stale health |
| Network / trust | `HomeTrustBanner` **not mounted** on `DesktopHomePage` | Used on pharmacy/hospitality pages |

**Verdict:** Health is **scattered and demoted**. Should become a dedicated Business Health area in the primary scan path (above or beside modules), not only footer chips.

**Business Health: 4.1 / 10**

---

# PART 9 — Reports Preview

| Aspect | Finding |
|--------|---------|
| Placement | Featured full-width tile after scene grid |
| Preview usefulness | Month sales `liveStat` + trend text only — **no chart/table** |
| Discoverability | Good for navigation; weak for executive scanning |

Reports remain “another module card” (louder than peers) rather than an executive preview block.

**Reports: 5.2 / 10**

---

# PART 10 — Responsive Experience

| Width | Observed structure (classes) |
|-------|------------------------------|
| 320–412 | Greeting centered; hero stacked; **2-col** scene; tall preview |
| 768 | `sm:` left greeting; denser gaps; hero still heavy |
| 1024+ | `lg:` hero row; profit 2-col option; scene **3-col**; page min-height |
| 1280–1536 | `xl:` 4-col; `2xl:` 5-col scene |

**Hierarchy consistency:** Module grid scales well. Executive hierarchy does **not** improve with width — no desktop KPI rail appears; ultrawide just adds more shouting tiles.

| Band | Score |
|------|------:|
| Desktop | **6.4** |
| Tablet | **6.1** |
| Mobile | **5.8** |

---

# PART 11 — Accessibility

| Check | Status |
|-------|--------|
| Contrast on gradient tiles | Risk — white/light text on varied gradients; custom tile colors via `launcherTileSurfaceStyle` |
| Font sizes | Greeting `text-xl`–`2xl`; liveStat readable |
| Tap targets | Hero CTA ≥52px; chips `min-h-[40px]`; cards large |
| Keyboard | Cards are `<button>`; focus ring present |
| Focus order | Greeting → hero controls → tile order (profit → scene → reports) → footer links |
| Screen reader | `aria-label` on hero & nav; greeting can be `sr-only` if no first name |
| Motion | `useHomeDashboardAnimationPause` / `motion-reduce` / spotlight pause |
| Emoji in status chips | Decorative `aria-hidden` — OK; meaning also in text |

**Accessibility: 5.6 / 10**

---

# PART 12 — Enterprise Design System Adoption

| Primitive | On terminal Home? |
|-----------|-------------------|
| `EnterpriseCard` | **No** |
| `EnterpriseKpiCard` | **No** |
| `EnterprisePageHeader` | **No** |
| Enterprise spacing / status tokens | Partial semantic tokens on hero (`border-border`, `bg-card`); tiles use hard-coded theme gradients |
| Button system | Custom primary CTA; cards are custom buttons |

**Legacy / parallel system:** `LivingDashboardCard` + `homeDashboardTheme` + Lottie/parallax/spotlight — a **second visual language** beside Command Center enterprise shell.

**Design System: 3.6 / 10**

---

# PART 13 — Performance

| Factor | Evidence |
|--------|----------|
| Metrics hook | `useHomeDashboardMetrics` — intentional live stats |
| Illustrations | `BusinessBuilderScene` + per-tile Lottie (`prefetchHomeTileLotties`) |
| Animation | Spotlight rotation, parallax on hero tiles, glow CSS vars |
| Layout stability | Rounded cards + hover translate; generally stable |
| Duplication | Risk/low-stock computed in tiles **and** status chips |

**Risk:** Visual richness can affect low-end Android responsiveness (Phase 24 already flagged Home launcher paths). Pause hooks mitigate but do not remove cost.

---

# PART 14 — Enterprise Dashboard Benchmark

Compared for **clarity / hierarchy / professionalism / decision support / confidence** — not layout copying.

| Dimension | WAKA Home | Typical modern exec dashboard |
|-----------|-----------|-------------------------------|
| Clarity | Medium (brand-forward) | High (status-forward) |
| Hierarchy | Weak (equal loud tiles) | Strong (KPI → alerts → work) |
| Professionalism | Consumer-premium | Enterprise-calm |
| Decision support | Low on Home; high on `/owner` | High on landing |
| Executive confidence | Moderate after scroll | Immediate |

**Summary:** WAKA’s **Command Center** is closer to the benchmark than **Home**. The strategic defect is **landing the wrong surface first** for owners/managers, not missing all executive capability in the product.

---

## Root Cause Analysis

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| **RC-1** | **P0** | Home identity is **launcher**, not executive workspace | `DesktopHomeTiles` + themes; Phase 30 already labeled “tile launcher” |
| **RC-2** | **P0** | Identity hero consumes primary scan space | `HomeBusinessHero` + `BusinessBuilderScene` height |
| **RC-3** | **P0** | Business health demoted to footer chips | `DesktopStatusChips` in page footer |
| **RC-4** | **P1** | No primary KPI strip / `EnterpriseKpiCard` | Metrics only as tile `liveStat` |
| **RC-5** | **P1** | Module cards compete equally via saturated gradients | `homeDashboardTheme` per-tile gradients |
| **RC-6** | **P1** | Executive workspace bifurcated to `/owner` | `EnterpriseDashboardShell` not post-login default |
| **RC-7** | **P1** | Reports lack executive preview | Featured tile + month stat only |
| **RC-8** | **P1** | Design system not adopted on Home | Zero Enterprise primitives |
| **RC-9** | **P2** | Quick actions absent on Home | `CommandCenterQuickActions` only on CC |
| **RC-10** | **P2** | No activity / attention feed on Home | Pharmacy/CC only |
| **RC-11** | **P2** | Performance cost of living tiles | Lottie + parallax + spotlight |
| **RC-12** | **P2** | First-run coaching ends before Home | `OnboardingRouteGate` → `/`; no Home tour |

---

## Before vs Desired Executive Workflow

### Before (current)

```
Login → (onboarding if needed) → Home launcher
  → admire shop scene → tap Sell or a loud module
  → (owners) maybe later open Command Center tile
  → scroll footer for sync/risks
```

### Desired (Phase 34.1 target — workflow, not a prescribed layout)

```
Login → Home command posture
  → greet + shop identity (compact)
  → today’s KPIs + health/alerts (primary scan)
  → quick actions (Sell, Cash, Stock, Reports)
  → modules (calm, consistent)
  → reports snapshot / activity (secondary)
```

Cashiers may keep a **Sell-first** emphasis; owners/managers need **status-first**.

---

## P0 / P1 / P2 Roadmap (Phase 34.1 candidates)

**Constraint for 34.1:** Presentation / IA / interaction only — no business-logic, pricing, sync engine, or API changes. Prefer **reuse** of Command Center widgets/primitives over inventing a third dashboard.

### P0 — Executive confidence

1. **Elevate Business Health** into the primary scan path (sync, risks, low stock, subscription urgency).  
2. **Add a primary KPI strip** for permitted roles (reuse `EnterpriseKpiCard` / Command Center builders where possible).  
3. **Reduce hero vertical dominance** so KPIs/health are above the fold on phone and desktop (identity retained, not deleted).

### P1 — Hierarchy & calm

4. Soften module card visual competition (unified surface; status color reserved).  
5. Clarify path to full Command Center for owners (or compose CC slots onto Home).  
6. Reports executive snapshot (mini summary, not only a nav tile).  
7. Adopt `EnterprisePageHeader` / spacing tokens on Home shell.

### P2 — Workflow polish

8. Role-aware quick actions strip.  
9. Optional attention/activity snippet.  
10. Trim living-tile motion cost on low-end devices.  
11. Light first-run Home orientation for new owners (optional).

### Explicit non-goals

- Do not redesign Sell / Inventory again.  
- Do not clone Square/Shopify/Toast layouts.  
- Do not merge multi-branch `/enterprise` into Home in 34.1 unless already scoped.

---

## Desktop / Tablet / Mobile Findings (summary)

| Band | Strength | Defect |
|------|----------|--------|
| **Desktop** | Multi-column grid; hero side-by-side | No KPI rail; ultrawide amplifies tile noise |
| **Tablet** | 2–3 columns | Hero + profit still push health down |
| **Mobile** | Large Sell CTA; 2-col modules | Preview height; footer health last |

---

## Accessibility Findings (summary)

- Structural landmarks exist (`navigation`, hero `aria-label`).  
- Gradient text contrast and emoji-led chips are the main residual risks.  
- Motion can be paused — good.  
- Keyboard access to tiles is sound; executive content order still wrong for SR users who hear art before status.

---

## Design System Findings (summary)

Home is the largest remaining **parallel design system** in the post-login app. Command Center proves enterprise primitives work. Phase 34.1 should **converge**, not invent Home-only components.

---

## Enterprise Benchmark Summary

WAKA can reach parity on **decision support** because Command Center already exists. Home fails the benchmark on **landing hierarchy and calm professionalism**. Closing the gap is an **IA composition problem**, not a greenfield dashboard build.

---

## Freeze Recommendation

| Surface | Freeze? |
|---------|---------|
| Sell (post 33.1) | Yes — maintenance mode for UI architecture |
| Inventory (prior phases) | Per prior certs |
| **Home / executive landing** | **No — not certified** |
| Command Center | Strong foundation; do not discard — **reuse** |

---

## Success Criteria — Answers

| Question | Answer |
|----------|--------|
| Does Home feel like a business command center? | **No** — it feels like a premium module launcher with identity hero. |
| What prevents world-class executive posture? | RC-1–3: wrong surface identity, hero cost, buried health. |
| Highest-return Phase 34.1 work? | Status-first scan (health + KPIs) + calm module shelf + reuse Command Center primitives. |
| Business logic changes required? | **No** for the P0/P1 roadmap. |

---

## Manual Certification Checklist (for Phase 34.1 acceptance)

### Executive scan
- [ ] Owner sees today’s status without scrolling past art-only content  
- [ ] Health (sync / risk / stock) visible in primary path  
- [ ] KPI strip readable in &lt;5 seconds  

### Launcher retained
- [ ] Sell/Dispense still one tap for cashiers  
- [ ] Module navigation still permission-gated  
- [ ] Hospitality `/floor` redirect unchanged  

### Regression
- [ ] No pricing / sync / inventory engine changes  
- [ ] Command Center still complete at `/owner`  
- [ ] Accessibility focus order remains logical  

---

*End of Phase 34.0 certification — read-only; no implementation in this phase.*

---

## Phase 34.1 — Enterprise Executive Workspace Implementation

**Mode:** Surgical IA / presentation (no business-logic changes)  
**Date:** 2026-08-04  

### Principle

> When a business owner logs in, they should understand the health of their business within 5 seconds.

### Before vs after information hierarchy

| Before (34.0) | After (34.1) |
|---------------|--------------|
| Greeting → tall identity hero → loud gradient tiles → footer health | Greeting → **compact hero** → **KPI strip** → **Business Health** → Reports preview → prioritized calm modules → license footer |
| Health buried in footer chips | Health above the fold (`HomeBusinessHealthSection`) |
| KPIs embedded in art tiles | `EnterpriseKpiCard` strip from existing `useHomeDashboardMetrics` |
| Every module shouts equally | Primary / Operations / Admin bands (`homeModulePriority`) |
| Living gradients + Lottie default | Calm `LivingDashboardCard` enterprise appearance |
| Parallel visual language vs `/owner` | Shared `EnterpriseCard` / `EnterpriseKpiCard` / status tokens |

### Executive workflow improvements

1. **Compact hero** (`HomeBusinessHero`) — shop identity, Open status, Sell/Dispense CTA; scene preview demoted (hidden on xs, ~72px on sm+).  
2. **KPI strip** — Today’s sales, transactions, profit, cash, low stock, debts (role-gated; same calculations as before).  
3. **Business Health** — connectivity, sync, risks, stock, subscription, device limit; link to Command Center when permitted.  
4. **Reports preview** — executive `HomeReportsPreview` with month liveStat (no new report math).  
5. **Module bands** — Primary (Inventory, Cash, …) → Operations → Admin (Settings, Investigation, Command Center).

### Files (presentation)

| Path | Role |
|------|------|
| `src/pages/DesktopHomePage.tsx` | Slim greeting + license footer |
| `src/components/home/DesktopHomeTiles.tsx` | Executive composition |
| `src/components/home/HomeBusinessHero.tsx` | Compact hero |
| `src/components/home/HomeExecutiveKpiStrip.tsx` | KPI strip |
| `src/components/home/HomeBusinessHealthSection.tsx` | Health section |
| `src/components/home/HomeReportsPreview.tsx` | Reports scan |
| `src/components/home/LivingDashboardCard.tsx` | Calm enterprise cards |
| `src/hooks/useHomeDashboardMetrics.ts` | Surfaces `{ byTile, executive }` |
| `src/lib/homeExecutiveKpis.ts` | KPI mapping helper |
| `src/lib/homeModulePriority.ts` | Module bands |

### Responsive verification

| Band | Hierarchy |
|------|-----------|
| Phone | Compact hero → 2-col KPIs → health grid → reports → modules |
| Tablet | Same order; denser KPI grid |
| Desktop / ultrawide | KPIs up to 6-col; modules 3–5 col; health 6-col |

### Regression summary

| Area | Changed? |
|------|----------|
| Auth / permissions / sync / offline / DB / APIs | No |
| Sales / inventory / reporting engines | No |
| Metric calculations | No (reuse only) |
| Command Center `/owner` | Unchanged; Home links into it |
| Home IA / presentation | **Yes** |

### Verification

- `npm run build` — passed  
- `npm test` — 1777 passed; 1 pre-existing `pharmacyPatientProfile` age flake  

### Success criteria — status

| Criterion | Status |
|-----------|--------|
| Home feels like executive dashboard, not launcher | **Met** |
| Health assessable in &lt;5 seconds | **Met** (KPIs + health above fold) |
| Modules navigate without competing with ops info | **Met** |
| Unified language with Command Center primitives | **Met** |
| No business-logic / data integrity changes | **Met** |

**Freeze recommendation (updated):** Home executive IA is ready for **maintenance-mode polish**; further work should be features (loyalty, multi-branch on Home) rather than another landing redesign.
