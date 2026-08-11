# Phase 37.0 — Enterprise Back Office Workspace & Administrative Operations Certification

**Mode:** Read-only enterprise audit (**NO code changes, NO CSS, NO SQL, NO migrations, NO dependency updates**)  
**Date:** 2026-08-04  
**Scope:** Back Office / Shop administration workspace — information architecture, navigation, productivity, responsive behavior, design-system consistency, performance, accessibility  
**Out of scope:** Cash Drawer / till operations deep-dive (**reserved for Phase 38.0**); Sell (32–33); Inventory engine (31/36); Home executive polish (34); EOD wizard (35); multi-branch `/enterprise/*` console  

**Canonical product name in code:** Back Office hub lives at **`/office`** (`POS_SHOP_ROUTE`), not `/back-office`. Settings is a **parallel launcher** (`isSettingsLauncherPath`). Command Center is **`/owner`**.

**Core question:**

> Can an owner manage the business efficiently without hunting through screens?

---

## Executive Summary

WAKA’s Back Office is a **secure, permission-gated administration shell** with real strengths: PIN/session unlock (`BackOfficeSessionContext` + `BackOfficeRouteGuard`), a five-section Office hub, a large Settings card launcher, catalog-driven **master search** on leaf routes, and strong enterprise shells for **Command Center** (`/owner`) and **Reports**.

It is **not yet a world-class administrative console**. Owners face **four competing entry hubs** (Home tiles, `/office`, `/settings`, `/owner`), **no persistent desktop left navigation**, **card-first browse** on many admin surfaces (Phase 30: back-office entity browse not certified), and **master search disabled** on the Office hub and Settings launcher paths. Inventory and cash operations sit inside Back Office path prefixes while also appearing as Home/ops shortcuts — efficient for power users, confusing for IA purity.

**Overall certification status: CONDITIONALLY CERTIFIED as a functional mid-market Shop / Back Office hub. NOT CERTIFIED as an enterprise administrative workspace** that matches modern owner/manager consoles for discoverability and desktop productivity.

**Freeze recommendation:** Do **not** freeze Back Office IA/navigation presentation. Preserve unlock/security, permissions, and business logic. Phase 37.1 should target hub consolidation, persistent desktop admin IA, design-system header parity, and admin productivity (search on hubs, tables, keyboard) without rewriting cash/inventory engines.

---

## Score Table

| Category | Score | Verdict |
|----------|------:|---------|
| Information Architecture | **5.8** | Coherent sections; competing hubs |
| Navigation | **5.5** | Search helps leaves; hubs & depth hurt |
| Productivity | **5.2** | Partial tables; weak bulk/keyboard |
| Tables | **5.5** | Staff/Devices/Customers OK; many card lists |
| Responsive | **6.5** | Mobile exit solid; desktop underused |
| Design System | **6.0** | Mixed Enterprise vs legacy headers |
| Performance | **7.0** | Light hubs; prior BO perf work |
| Accessibility | **5.8** | Partial labels; card-nav & PIN friction |
| **Overall** | **5.9 / 10** | Conditional mid-market |

---

## Certification Methodology

1. Static forensics of routes (`App.tsx`), path classifiers (`backOfficePaths.ts`), hub definitions (`officeHubSections.ts`, Settings hub), shell chrome (`AppShell`, `unifiedNav`, `enterpriseBottomChrome`).  
2. Cross-check against prior certifications: Phase 22.x (workspace polish), Phase 30 (desktop tables — BO not certified), Phase 34 (Home vs `/owner`), Phase 26 (reports/investigation).  
3. Workflow click-count analysis for common owner tasks.  
4. No live device lab / Systrace in this phase.

---

## Workflow Map

```
Primary nav (unified)
  /  Home (launcher tiles — Phase 34 executive strip)
  /pos  Sell
  /office  Back Office hub  ←──── canonical Shop / BO

/office
  → 5 section tiles (daily | insights | shop-control | data | help)
  → /office/section/:id → card grid → leaf routes

Parallel hubs (compete with /office)
  /settings     Settings launcher (Shop + App groups)
  /owner        Command Center (executive)
  /             Home tiles → many same destinations

Security gate
  BackOfficeRouteGuard → PIN / biometric unlock (session)
  Limited bypass: stock-keeper paths, debt paths

Leaf domains (BO path prefixes)
  /stock · /reports · /customers · /debts · /staff-access
  /close-day · /cash-expenses · /office/* · /settings/*
```

| Owner task | Typical path from Home | Clicks | Friction |
|------------|------------------------|-------:|----------|
| View reports | Home → Reports | 1 | Low |
| Open Command Center | Home → Command Center | 1 | Low |
| Edit shop profile | Home → Settings → Shop | 2 | Low |
| Manage devices | Home → Settings → Devices | 2 | Low |
| Hardware / printer | Home → Settings → Hardware | 2 | Low (path is `/office/hardware` but Settings-classified) |
| Manage suppliers | Home → Inventory → Suppliers tab | 2 | Medium (ops vs admin blur) |
| Add staff | Home → Settings → Staff → Create | 3–4 | Medium |
| Same via Office hub | Home → Shop → Shop Control → Staff → Create | 4–5 | High |
| Configure taxes (retail) | — | n/a | **No dedicated tax admin module** |
| Taxes (hospitality) | Settings → Hospitality → tax toggles | 3 | Hidden |

---

# PART 1 — Administrative Information Architecture

### What exists

| Layer | Structure | Evidence |
|-------|-----------|----------|
| Office hub | 5 sections: Daily, Insights, Shop Control, Data, Help | `officeHubSections.ts` |
| Section bodies | Permission-gated nav cards | `OfficeHubSectionBody.tsx` |
| Settings hub | Shop group + App group card lists | `SettingsHubPage.tsx` |
| Command Center | Executive KPI / attention / integrity | `/owner` → `OwnerDashboardPage` |
| Master search catalog | Keyword jump to modules | `backOfficeSearchCatalog.ts` |

### Strengths

- Once inside `/office`, section grouping is **logical** (daily ops vs insights vs control vs data vs help).  
- Settings separates **shop configuration** from **app/personalization**.  
- Role-limited paths (stock keeper, debt) avoid forcing full BO access.

### Weaknesses

1. **Four hubs compete** — Home, Office, Settings, Owner (Phase 34 already flagged Home vs Owner).  
2. **Inventory straddles** Home ops tile + Office Daily + BO path prefix `/stock`.  
3. **Cash / EOD surfaces** live under `/office/*` and Home tiles — correct for ops, but Phase 38 should own cash UX certification separately.  
4. **No first-class Taxes** admin module for general retail.  
5. **Legacy redirects** (`/suppliers`, `/restock`, `/office/purchases`, `/owner/activity`) increase mental map size without adding capability.

**Information Architecture: 5.8 / 10**

---

# PART 2 — Navigation

| Mechanism | Status | Evidence |
|-----------|--------|----------|
| Primary nav | Home / Sell / Office | `unifiedNav.ts` |
| Office section drill-in | Tile → cards → page | `OfficeHubPage` / `OfficeHubSectionPage` |
| Settings | Flat long card grid | `SettingsHubPage` |
| Breadcrumbs | Back fallbacks / headers; not full trail | `EnterprisePageHeader` / `PageHeader` |
| Side navigation | **Absent** on desktop | Phase 30; `BackOfficePageLayout` tile grid |
| Master search | On BO leaves; **off** on `/office` hub + Settings launcher | `AppShell` + `isSettingsLauncherPath` |
| Mobile exit | Module-exit bottom bar | `enterpriseBottomChrome` / `MobileModuleExitBar` |
| Desktop bottom chrome | None in BO | `mode: "none"` |

### Click economics

- **Power users with Home tiles:** many tasks are 1–2 clicks — good.  
- **Users who land on Shop (`/office`) first:** +1–2 clicks vs Home shortcuts — hub feels like a second menu.  
- **Settings + Staff create:** 3–4 clicks — acceptable but wizard discoverability depends on Settings card scan.  
- **PIN unlock:** adds a security step on BO entry when configured — correct, but counts as workflow tax.

**Navigation: 5.5 / 10**

---

# PART 3 — Workspace Organization

| Function | Where it lives | Belongs together? |
|----------|----------------|-------------------|
| Products / stock / purchases / suppliers | `/stock` (+ redirects) | Yes as inventory ops; competes with “admin” mental model |
| Categories / shelves arrange | Sell prefs + `/settings/shelves` | Split from stock hub |
| Customers / debts | `/customers`, `/debts` | Clear |
| Staff / roles / security | `/staff-access`, `/settings/staff-*` | Clustered but multi-leaf |
| Taxes | Hospitality settings only | **Missing** as shop-wide admin |
| Settings / devices / hardware | `/settings/*`, `/office/hardware` | Split path taxonomy (`isSettingsLauncherPath`) |
| Reports / profit / audit | `/reports`, `/office/profit`, `/office/audit-center` | Insights cluster OK; also on Home |
| Command Center | `/owner` | Strong workspace; not the BO hub |
| Cash drawer / close day | `/office/cash-drawer`, `/close-day`, … | Ops (Phase 38) |

**Finding:** Functions do not all “compete visually” on one screen — they compete **across hubs**. Inside a single hub, cards are calm; across the product, owners must learn which launcher owns which job.

---

# PART 4 — Administrative Productivity

| Capability | Back Office readiness | Evidence |
|------------|----------------------|----------|
| Bulk actions | Weak outside inventory selection | Phase 30 |
| Filtering / search | Master search on leaves; per-page filters elsewhere | `BackOfficeMasterSearch` |
| Desktop tables | Staff, Devices, Customers (+ inventory) | `*DesktopTable` / `EnterpriseDataTable` |
| Keyboard workflow | POS-centric shortcuts; **no BO admin shortcut system** | `posKeyboardShortcuts` scope |
| Batch operations | Rare on admin entity pages | Phase 30 |
| Jump-to-module | Strong when search chrome is visible | Catalog filter |

**Enterprise readiness:** Mid-market with **islands of table productivity**; not a consistent admin data workspace.

**Productivity: 5.2 / 10**  
**Tables: 5.5 / 10**

---

# PART 5 — Responsive Experience

| Viewport | Behavior | Assessment |
|----------|----------|------------|
| Phone | Module exit bar; 2-col tile grids; sticky BO layout | **Good** for launcher-style admin |
| Tablet | Same card patterns scaled | Acceptable; not a dedicated tablet IA |
| Desktop | No left nav; full-width content; tables on some leaves | **Underuses widescreen** (Phase 30) |
| Ultrawide | Content still mostly single-column hub + cards | Weak density |

**Responsive: 6.5 / 10**

---

# PART 6 — Design System

| Primitive | Adoption in BO | Gap |
|-----------|----------------|-----|
| `EnterprisePageHeader` | Office hub, Settings hub, many leaves via `SettingsPageHeader` | — |
| `PageHeader` (legacy) | **Office section pages** | `OfficeHubSectionPage.tsx` |
| `EnterpriseCard` / `OfficeNavCard` | Hubs and many leaves | Inconsistent density |
| `EnterpriseDataTable` | Staff / Devices / Customers / inventory | Not universal |
| `BackOfficePageLayout` | Standard hub shell | Tile-grid oriented |
| Typography / status tokens | Command Center / Reports strong | Hubs more launcher-like |
| Buttons | `WakaButton` / enterprise patterns mixed | Leaf variance |

**Legacy UI hotspots:** Office section headers; card-first entity browse; Home parallel visual language vs `/owner` (Phase 34).

**Design System: 6.0 / 10**

---

# PART 7 — Performance

| Concern | Finding |
|---------|---------|
| Hub navigation | Light tile/card trees — typically fast |
| Master search | Client catalog filter — fine at current module counts |
| Tables | Virtualization where Phase 30 applied; card lists cheaper to paint, slower to scan |
| Dialogs | Unlock modal + settings gates — acceptable |
| Heavy pages | Command Center / Reports compute more — separate shells, not the hub itself |
| Prior work | `backOfficePerformanceProfile` / optimization tests exist |

**Performance: 7.0 / 10** (hubs are not the primary bottleneck; productivity UX is).

---

# PART 8 — Accessibility

| Area | Status |
|------|--------|
| Keyboard | Partial; no BO shortcut map; card grids are pointer-oriented |
| Focus | Unlock modal structured; leaf forms vary |
| Screen readers | Icons often `aria-hidden`; card titles present; limited landmarks for admin IA |
| Contrast | Enterprise tokens help; launcher tile colors vary |
| Touch targets | Hub cards generally large; dense settings leaves historically flagged (Phase 22.1) |
| Security UX | PIN gate is accessible via dialog patterns but interrupts flow |

**Accessibility: 5.8 / 10**

---

# PART 9 — Enterprise Comparison (workflow reference only)

| Expectation (modern admin consoles) | WAKA today |
|-------------------------------------|------------|
| One admin home with persistent nav | Four hubs; no left admin nav |
| Global admin search always available | Search omitted on Settings + Office hub |
| Dense desktop tables for entities | Partial (Phase 30 gap) |
| Clear Settings vs Operations split | Path taxonomy split exists but destinations duplicate |
| Tax / fiscal configuration discoverable | Missing for general retail |
| Executive dashboard at hand | Excellent at `/owner`, secondary to Home |

Focus: productivity / discoverability / consistency / efficiency — not visual cloning of other products.

---

# PART 10 — Root Cause Register

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| **RC-1** | **P0** | Navigation fragmentation — Home, Office, Settings, and Owner compete as admin homes | `launcherTiles.ts`, `OfficeHubPage`, `SettingsHubPage`, `OwnerDashboardPage`; Phase 34 |
| **RC-2** | **P0** | No persistent desktop left (or secondary) admin navigation — card hubs scale poorly on wide screens | Phase 30 L227–243; `BackOfficePageLayout` / `OFFICE_NAV_TILE_GRID` |
| **RC-3** | **P1** | Master search unavailable on Office hub and Settings launcher paths | `isSettingsLauncherPath` + `AppShell` search gating |
| **RC-4** | **P1** | Duplicate administration paths (intentional multi-entry without a single source of truth UX) | Home tiles + Office cards + Settings cards → same routes |
| **RC-5** | **P1** | Legacy header on Office section pages (`PageHeader`) vs enterprise hubs | `OfficeHubSectionPage.tsx` L27–34 |
| **RC-6** | **P1** | Desktop productivity gaps — bulk/keyboard/table coverage incomplete for BO entities | Phase 30 certification decision |
| **RC-7** | **P1** | Inventory & cash ops blur “admin workspace” vs “daily operations” | `/stock` & cash routes in BO prefixes + Home tiles |
| **RC-8** | **P2** | No dedicated shop-wide Taxes admin module | Hospitality settings + reports empty state only |
| **RC-9** | **P2** | Hardware under `/office/hardware` but classified as Settings launcher for exit/search | `backOfficePaths.ts` L25–31 |
| **RC-10** | **P2** | PIN unlock friction (security-correct) without progressive trust UX for short sessions | `BackOfficeRouteGuard`, `BackOfficeSessionContext` |

---

## P0 / P1 / P2 Roadmap (Phase 37.1+)

### P0 — Make administration findable and desktop-usable

1. **Declare a single Back Office mental model** — e.g. `/office` as admin home; Home tiles become shortcuts into that model (not a parallel IA). Preserve `/owner` as executive Command Center.  
2. **Add persistent desktop admin navigation** (section rail or secondary nav) for Office + key leaves — without removing mobile card hubs.  
3. **Enable master search on Office hub** (and evaluate Settings hub) so owners never “hunt” without a jump box.

### P1 — Consistency & productivity

4. Replace `PageHeader` on `OfficeHubSectionPage` with `EnterprisePageHeader`.  
5. Expand `EnterpriseDataTable` + filters to remaining high-traffic admin lists.  
6. Reduce duplicate card copy / clarify Settings vs Office ownership in UI copy.  
7. Lightweight keyboard: focus search (`/`), Escape to hub — admin-scoped only.  
8. Align Hardware path taxonomy (search/exit) with user-facing Settings grouping.

### P2 — Future enterprise admin

9. First-class Taxes / fiscal preferences module when product scope requires it.  
10. Admin bulk actions where safe (staff deactivate batch, device approve batch — policy permitting).  
11. Optional “recent admin destinations” / pinned office tools.  
12. Deeper a11y pass: landmarks, skip link into admin nav, SR announcements on unlock.

### Explicit non-goals for early 37.1

- Do not rewrite cash ledger / EOD (Phase 38).  
- Do not change inventory pricing/stock engines.  
- Do not weaken Back Office PIN / permission model.  
- Do not merge Command Center into Home without a deliberate product decision (Phase 34 already separated roles).

---

## Desktop Findings

| Strength | Defect |
|----------|--------|
| Command Center & Reports shells | No left admin IA |
| Staff / Devices / Customers tables | Many BO surfaces still card-first |
| Full-width terminal chrome available | Ultrawide density unused on hubs |
| No mobile bottom bar clutter | Exit/back patterns vary by leaf |

---

## Mobile Findings

| Strength | Defect |
|----------|--------|
| Module-exit bar for depth | Long Settings card lists require scan |
| Large hub tiles | Two-level Office drill-in adds taps vs Home shortcuts |
| Unlock modal usable | Unlock every session when PIN set |
| Search on leaves | Search missing on Settings / Office hub |

---

## Accessibility Findings

- Decorative icons generally hidden from AT.  
- Card navigation lacks a semantic “admin sitemap” landmark.  
- Keyboard power-user path is underdeveloped vs Sell.  
- Contrast/tokens improved via enterprise system; launcher tile custom colors can drift.  
- Touch targets on hub cards are adequate; dense settings forms need ongoing vigilance.

---

## Regression Risk Assessment (for Phase 37.1)

| Change type | Risk to business logic |
|-------------|------------------------|
| Nav chrome / hub IA | Low if routes & permissions unchanged |
| Enable search on hubs | Low |
| Header primitive swap | Low |
| Table adoption on lists | Low–medium (selection/bulk must respect permissions) |
| Weakening unlock/PIN | **High — out of scope** |
| Merging cash into admin redesign | High — defer to Phase 38 |

---

## Freeze Recommendation

| Surface | Freeze? |
|---------|---------|
| Back Office unlock / session security | **Yes** (behavior) — polish UX only |
| Permissions & route guards | **Yes** |
| Cash ledger / EOD algorithms | **Yes** (Phase 38 owns UX) |
| **BO information architecture & admin chrome** | **No** — Phase 37.1 |
| Inventory / pricing engines | **Yes** |

---

## Success Criteria — Answers

| Question | Answer |
|----------|--------|
| Can an owner manage efficiently without hunting? | **Partially** — Home shortcuts + search help power users; first-time or Office-first users still hunt across hubs. |
| Is Back Office a true enterprise admin workspace? | **Not yet** — functional Shop hub + strong CC/Reports islands; missing persistent desktop admin IA and consistent productivity. |
| Ready for Phase 37.1? | **Yes** — RCs are presentation/IA/productivity; business logic can stay frozen. |
| Next independent audit? | **Phase 38.0 — Cash Drawer, Till Operations & Cash Management** |

---

## Manual Certification Checklist (for Phase 37.1 acceptance)

### IA / Navigation
- [ ] Owner can state one “admin home” and reach staff, settings, reports, devices without dead ends  
- [ ] Desktop shows persistent section navigation on `/office` and key leaves  
- [ ] Master search available from Office hub  

### Productivity
- [ ] Staff / Devices / Customers remain table-capable on desktop  
- [ ] No regression in permissions or unlock  

### Responsive
- [ ] Phone module exit still returns correctly  
- [ ] Tablet card hub remains usable  

### Design system
- [ ] Office section pages use `EnterprisePageHeader`  
- [ ] No new legacy `PageHeader` surfaces in BO  

### Regression
- [ ] `/owner` Command Center intact  
- [ ] `/stock` inventory flows intact  
- [ ] Cash routes reachable (Phase 38 will deepen)  

---

*End of Phase 37.0 certification — read-only; no implementation in this phase.*  
*Recommended next: Phase 38.0 — Enterprise Cash Drawer, Till Operations & Cash Management Certification (independent of Back Office IA).*
