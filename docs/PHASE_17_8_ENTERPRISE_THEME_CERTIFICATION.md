# Phase 17.8 — Enterprise Theme, Dark Mode & Light Mode Certification

**Mode:** Read-only UI audit (no code changes)  
**Date:** 2026-07-11  
**Verdict:** **Not certified** — architecture is sound; visual consistency and dark-mode polish require a focused remediation phase before onboarding scale.

---

## Executive Summary

Waka POS has a **unified theme runtime** (`AppThemeProvider`, class-based dark mode, CSS-variable core palette, pre-paint bootstrap) but **most production surfaces still paint with hardcoded `stone-*` and `bg-white` utilities** rather than semantic tokens. Dark mode works today largely through a **global CSS remap bridge** in `index.css` — a migration aid, not a design system.

**Highest-impact gaps:**

1. **Charts & SVG visualizations** use hardcoded hex/RGB — do not adapt to dark mode.
2. **Status badges** (success/warning/error/info) use light pastels with **no dark pairs** — washed-out on dark cards.
3. **Enterprise primitives** are **Partial** at best — skeleton, save indicator, and switch off-state are visibly wrong in dark mode.
4. **Internal Admin** is **light-only** — breaks theme continuity when the app is in dark mode.
5. **`wakaUi` semantic bundles exist but are under-adopted** (~76 files vs ~500 with hardcoded colors).

**Recommendation:** Treat Phase 17.8 remediation as a **token migration + status/chart system** initiative before payment integration or major onboarding pushes. Users will notice theme polish immediately.

---

# 1. Enterprise Theme Certification Report

## 1.1 Theme Architecture

### Runtime stack

```
localStorage (waka-app-theme: system | light | dark)
        ↓
bootstrapAppThemeClass() — main.tsx, pre-React paint
        ↓
AppThemeProvider — preference + matchMedia → resolved theme
        ↓
applyAppThemeClass() → <html class="dark marketing-theme-dark">
        ↓
CSS variables (:root / .dark) + Tailwind mappings
        ↓
Components (stone/bg-white ad-hoc OR wakaUi semantic tokens)
```

| Layer | File(s) | Role |
|-------|---------|------|
| Provider | `src/context/AppThemeProvider.tsx` | Canonical React context |
| Core logic | `src/lib/appTheme.ts` | Storage, resolve, DOM class application |
| Bootstrap | `src/main.tsx`, `index.html` (partial/stale) | Flash prevention |
| Tailwind | `tailwind.config.ts` | `darkMode: ["class", ".dark", ".marketing-theme-dark"]` |
| Global CSS | `src/index.css` | Semantic vars + `.dark` remap bridge |
| Brand bundles | `src/lib/brandTokens.ts` → `wakaUi.*` | Intended SSOT for surfaces/inputs/buttons |
| Marketing | `src/components/marketing/marketingThemeClasses.ts` | Isolated `--mkt-*` namespace |
| Settings UI | `src/pages/SettingsAppearancePage.tsx`, `AppThemeToggle.tsx` | User-facing theme control |

### Semantic color tokens (centralized)

| Token | CSS var | Tailwind | Dark override |
|-------|---------|----------|---------------|
| Background | `--background` | `bg-background` | ✅ |
| Foreground | `--foreground` | `text-foreground` | ✅ |
| Card | `--card` | `bg-card` | ✅ |
| Muted | `--muted`, `--muted-foreground` | ✅ | ✅ |
| Border / Input | `--border`, `--input` | ✅ | ✅ |
| Primary (brand orange) | `--primary` | ✅ | ❌ unchanged |
| Destructive | `--destructive` | ✅ | ❌ unchanged |
| **Success** | — | — | ❌ **missing** |
| **Warning** | — | — | ❌ **missing** |
| **Info** | — | — | ❌ **missing** |
| Accent / Popover / Chart | — | — | ❌ **missing** |

### Architecture strengths

- Single provider for app, auth, and marketing (legacy aliases preserved).
- Pre-paint bootstrap prevents theme flash; `color-scheme` meta supports native controls.
- Documented brand SSOT (`brandTokens.ts`, `resources/brand/README.md`).
- Inventory wizards (`wizardTokens.ts`, `receiveTokens.ts`) demonstrate the **target pattern**.
- Global `.dark` remap gives broad coverage without touching 500+ files — useful as a bridge.

### Architecture gaps

| ID | Severity | Gap |
|----|----------|-----|
| T-001 | High | No centralized success/warning/info/destructive **status token system** |
| T-002 | High | `wakaUi` bundles under-adopted; `stone-*` is the de-facto neutral system |
| T-003 | High | `.dark` remap incomplete — misses `stone-200/300`, opacity variants (`/80`, `/90`), colored pastels |
| T-004 | Medium | `index.html` inline script reads legacy `waka-marketing-theme` only — diverges from unified key |
| T-005 | Medium | Internal Admin shell hardcoded light — exempt from app theme |
| T-006 | Medium | Enterprise UX rules (`enterpriseUxRules.ts`) define components, not color contracts |
| T-007 | Low | Deprecated `marketingTheme.ts` duplicate helpers still present |

### Design system maturity

**Hybrid model:** shadcn-style CSS vars + Waka brand scale + global remap hack + widespread ad-hoc Tailwind.

**Certification status:** Runtime architecture **Pass** · Token completeness **Fail** · Adoption **Fail**

---

# 2. Dark Mode Report

Issues **unique to or most visible in dark mode**.

## 2.1 Critical (text/UI effectively broken or misleading)

| ID | Surface | Issue | Location |
|----|---------|-------|----------|
| DM-C01 | Charts | SVG grid lines, ring tracks, stroke colors hardcoded light gray/orange — invisible or low contrast on dark cards | `AnalyticsCharts.tsx`, `ProfitTrendChart.tsx`, `CommandCenterHealthHero.tsx`, `CommandCenterStaffCard.tsx` |
| DM-C02 | Status badges | `bg-emerald-50`, `bg-amber-50`, `bg-rose-50`, `bg-sky-50` stay light pastels on dark-remapped cards — illegible borders, poor contrast | Investigation Center, Command Center, pharmacy expiry, hospitality tickets, toasts |
| DM-C03 | Skeleton loaders | `bg-stone-200/80` not remapped — bright gray pulse on dark surfaces | `EnterpriseSkeleton.tsx` |

## 2.2 High

| ID | Surface | Issue | Location |
|----|---------|-------|----------|
| DM-H01 | Hospitality floor | `TABLE_STATUS_COLORS.blocked` uses `bg-stone-200` — not remapped; blocked tables look like light-mode patches | `lib/hospitality.ts`, `FloorPlanPage.tsx` |
| DM-H02 | Switch off-state | `WakaSwitch` track `bg-stone-300` unmapped — off switches appear light gray | `WakaSwitch.tsx` |
| DM-H03 | Save indicator | Emerald/amber status chips (`bg-emerald-100`, `bg-amber-100`) light-only | `EnterpriseSaveIndicator.tsx` |
| DM-H04 | Internal Admin | Full-screen admin overlay stays `bg-stone-100`/`bg-white` while app shell is dark — jarring discontinuity | `AdminShell.tsx`, `adminUi.tsx`, `v2/primitives.tsx` |
| DM-H05 | POS keypad | Checkout keypad `bg-stone-100`/`bg-stone-200` not remapped — mismatched tone on dark card | `PosCheckoutPanel.tsx` |
| DM-H06 | Focus rings | `ring-offset-white` on status chips — wrong offset in dark mode | `DesktopStatusChips.tsx` |

## 2.3 Medium

| ID | Surface | Issue |
|----|---------|-------|
| DM-M01 | Empty states | `EnterpriseEmptyState` opacity utilities (`bg-stone-50/80`, `ring-stone-200/80`) outside remap rules |
| DM-M02 | List footer | Amber truncation banner (`border-amber-200 bg-amber-50`) light-only |
| DM-M03 | Scroll FABs | `border-stone-200/90` opacity border may stay light-tinted |
| DM-M04 | Modal sheets | `ModalSheet` panel relies on remap; backdrop `bg-black/55` OK |
| DM-M05 | Back navigation | `PageBackBar` `text-waka-800` — no dark variant; readable but not harmonized |
| DM-M06 | Settings (non-appearance) | Selling, finance diagnostics, cloud trust — no explicit `dark:` |
| DM-M07 | Health hero gradient | `from-white via-white to-waka-50/40` — partial remap only |

## 2.4 Dark mode surfaces that work well

- **Auth flow** — `LoginPage`, `AuthLayout`, staff lock screen: explicit `dark:` pairs (best in codebase).
- **App shell chrome** — global remap covers most `bg-white`, `text-stone-*`, `border-stone-*`.
- **Data tables** — `.waka-data-table` has explicit `.dark` rules in `index.css`.
- **Inventory wizards** — semantic `bg-card`, `text-foreground`, `border-border`.
- **Marketing site** — isolated `--mkt-*` tokens with dark overrides.

**Dark mode score:** **6.2 / 10** — functional via remap bridge; not polished or intentional.

---

# 3. Light Mode Report

Light mode is the **primary design target** and generally looks intentional. Issues are mostly **consistency and token debt**, not readability failures.

## 3.1 Strengths

- Warm cream/stone palette aligns with Waka brand identity.
- Orange primary CTAs (`waka-600` + `text-white`) have strong contrast.
- Card elevation (`shadow-waka-sm`, rounded-2xl) reads premium on light backgrounds.
- POS sell screen orange header + white body is visually coherent.
- Internal Admin light shell is polished **when viewed in isolation**.

## 3.2 Light-mode-specific issues

| ID | Severity | Issue |
|----|----------|-------|
| LM-H01 | High | **Inconsistent surface recipe** — same visual card achieved via `bg-white`, `bg-card`, `wakaUi.surface`, and `lovableUi` branch in different files |
| LM-M01 | Medium | Duplicate neutral palette — `stone-*` used 4,588× while `gray/slate/zinc` absent; no single neutral token |
| LM-M02 | Medium | Status badge colors differ per module (rose vs red, amber-50 vs amber-100) — drift risk |
| LM-M03 | Medium | Settings pages mix enterprise layout with non-enterprise color patterns |
| LM-L01 | Low | Some `text-stone-400` captions may fall below WCAG AA on `bg-stone-50` (needs spot-check per screen) |
| LM-L02 | Low | Heavy use of `shadow-sm` vs `shadow-waka-sm` — elevation inconsistency |

## 3.3 Light mode regression risks (vertical)

| Vertical | Light mode quality | Notes |
|----------|-------------------|-------|
| POS | ✅ Strong | Brand-forward, high contrast |
| Auth | ✅ Strong | Clean, intentional |
| Settings | ⚠️ Good | Repetitive stone/white cards |
| Reports / IC / Command Center | ⚠️ Adequate | Functional but generic |
| Pharmacy / Hospitality | ⚠️ Adequate | Status pastels OK on light cards |
| Internal Admin | ✅ Strong (light only) | Professional admin aesthetic |
| Enterprise HQ | ⚠️ Adequate | Same card recipe as settings |

**Light mode score:** **8.1 / 10** — polished enough for daily use; lacks systematic token discipline.

---

# 4. Hardcoded Color Report

## 4.1 Quantitative summary (`src/**`)

| Pattern | Files | ~Uses | Classification |
|---------|------:|------:|----------------|
| `stone-*` (text/bg/border) | 461 | 4,588 | **Hardcoded** (partially remapped in dark) |
| `bg-white` | 381 | 969 | **Hardcoded** (remapped → `--card` in dark) |
| `text-white` | 265 | 525 | **Valid** on brand/colored buttons |
| `bg-black` | 41 | 52 | **Valid** (modal scrims) |
| `text-black` | 0 | 0 | — |
| `gray-*` / `slate-*` / `zinc-*` | 0 | 0 | Absent (stone replaced them) |
| Explicit `dark:` variants | 26 | 199 | **Theme-aware** (underused) |
| Semantic tokens (`bg-background`, `text-foreground`, etc.) | 76 | 303 | **Theme-aware** (target) |

**~500 files** contain hardcoded color utilities; **~96%** have zero explicit `dark:` classes.

## 4.2 Top offenders (combined hardcoded score)

| Rank | File | Domain |
|-----:|------|--------|
| 1 | `src/pages/PosPage.tsx` | POS |
| 2 | `src/components/pos/PosCheckoutPanel.tsx` | POS |
| 3 | `src/components/settings/CloudTrustCenter.tsx` | Settings |
| 4 | `src/components/internal-admin/InternalAdminsManagement.tsx` | Admin |
| 5 | `src/components/internal-admin/v2/ops/OpsWidgets.tsx` | Admin |
| 6 | `src/components/staff/StaffCreateWizard.tsx` | Staff |
| 7 | `src/components/internal-admin/v2/pages/AdminPricingCampaignsPage.tsx` | Admin |
| 8 | `src/components/hospitality/ReservationDialogs.tsx` | Hospitality |
| 9 | `src/components/cash-position/CashPositionMoreSections.tsx` | Finance |
| 10 | `src/pages/SettingsFloorPage.tsx` | Settings |

## 4.3 Classification examples

| Pattern | Example | Verdict |
|---------|---------|---------|
| `bg-waka-600 text-white` on CTA | Settings, POS buttons | **Valid** |
| `bg-black/50` modal scrim | `ModalSheet.tsx` | **Valid** |
| `border-stone-200 bg-white p-4` | Most settings pages | **Hardcoded** — should use `wakaUi.surface` |
| `text-stone-600` body copy | Widespread | **Hardcoded** — should use `text-muted-foreground` |
| `bg-emerald-100 text-emerald-900` badge | Save indicator, toasts | **Should use semantic status tokens** |
| `border-border bg-card text-foreground` | Inventory count header | **Theme-aware** ✓ |
| `dark:bg-stone-900` paired | `LoginPage.tsx` | **Theme-aware** ✓ |

## 4.4 Global dark remap (bridge, not solution)

`index.css` lines ~603–699 remap `.dark .bg-white`, `.text-stone-950`, `.border-stone-200`, etc. to semantic vars.

**Not covered:** `stone-200/300`, opacity modifiers, `emerald/amber/rose/sky` pastels, gradients, `indigo-*`, chart hex colors, `ring-offset-white`.

## 4.5 Reference implementation

Migrate toward patterns already proven in:

- `src/lib/brandTokens.ts` → `wakaUi`
- `src/components/inventory/count/CountHeader.tsx`
- `src/components/stock/wizard/wizardTokens.ts`
- `src/pages/InternalActivationOpsPage.tsx` (non-lovable branch)

**Hardcoded color debt score:** **3.5 / 10** — extensive, mitigated but not resolved.

---

# 5. Accessibility Report

## 5.1 WCAG contrast

| Area | Light mode | Dark mode | Notes |
|------|------------|-----------|-------|
| Primary buttons (waka-600 + white) | ✅ AA+ | ✅ AA+ | Stable |
| Body text (stone-900 on white) | ✅ AA | ✅ AA (via remap) | OK |
| Captions (stone-500/600) | ⚠️ AA borderline on stone-50 | ⚠️ Remapped to muted | Spot-check needed |
| Disabled controls (`opacity-50`) | ⚠️ | ⚠️ | May fail AA — common industry gap |
| Status pastels on dark cards | N/A | ❌ Fail | Light bg + dark text on dark surface |
| Chart grid lines | ✅ light | ❌ Fail | Too faint on dark |
| Links (`text-waka-800`) | ✅ | ⚠️ | No dark-specific link token |

## 5.2 Keyboard focus

- `wakaUi.input` defines `focus:ring-2 focus:ring-waka-200` — good baseline.
- `WakaSwitch` uses `ring-waka-400 ring-offset-2` — offset may default to white.
- Focus coverage is **inconsistent** — many interactive elements rely on browser default or `active:opacity-70` only.
- Internal admin and POS keypad buttons often lack visible `focus-visible` rings.

## 5.3 Interaction states

| State | Coverage | Gap |
|-------|----------|-----|
| Hover | Good on buttons | Weak on table rows, list items |
| Active | `active:bg-*` common | — |
| Disabled | `disabled:opacity-50` common | Contrast not verified |
| Selected | Tab bars, nav items OK | Inconsistent across modules |
| Focus-visible | Partial | Not systematic |

## 5.4 Non-color indicators

- `DesktopStatusChips` uses emoji (🔴🟠🟢) alongside color — accessibility concern for color-blind users.
- Investigation severity uses color + text labels — acceptable when label present.

**Accessibility score:** **6.8 / 10** — core flows OK; dark status colors and focus rings need work.

---

# 6. Premium UI Report

Comparison target: **Stripe Dashboard**, **Linear**, **Notion**, **Microsoft 365 Admin** — calm neutrals, semantic surfaces, consistent elevation, theme-native charts.

## 6.1 What already feels enterprise-grade

| Dimension | Waka today | Benchmark |
|-----------|------------|-----------|
| Brand identity | Strong orange/cream warmth | Distinct vs generic SaaS gray |
| Touch targets | 44–48px min-height | ✅ Mobile-first POS quality |
| Border radius | Consistent 2xl cards | ✅ Modern |
| Typography weight | `font-black` headings | ✅ Confident hierarchy |
| POS sell screen | Purpose-built, fast | ✅ Best-in-class for vertical |
| Internal admin | Clean Roboto admin shell | ✅ M365-adjacent |

## 6.2 Gaps vs premium reference apps

| Dimension | Current state | Recommendation |
|-----------|---------------|----------------|
| **Color harmony** | Stone + ad-hoc pastels | Introduce `statusTokens` + dark pairs |
| **Elevation** | Mixed `shadow-sm` / `shadow-waka-sm` | Standardize 2 elevation levels via tokens |
| **Surfaces** | 969× `bg-white` | Migrate to `wakaUi.surface` |
| **Theme transitions** | Instant class toggle | Optional 150ms `color`/`background` transition on `html` |
| **Charts** | Hardcoded hex | CSS-var-driven `chartTokens` |
| **Dark mode parity** | Remap hack | First-class dark tokens, not afterthought |
| **Navigation** | App shell good | Command Center / IC need same polish |
| **Empty states** | Functional | Softer muted surfaces, semantic icons |
| **Data density** | POS excellent | Reports could use tighter rhythm |

## 6.3 Recommended polish initiatives (Phase 17.8 implementation)

1. **`statusTokens.ts`** — success/warning/error/info/pending with light + dark class pairs.
2. **`chartTokens.ts`** — CSS variables for grid, axis, series colors; read in SVG via `currentColor` or `getComputedStyle`.
3. **Primitive migration sprint** — enterprise components → `wakaUi` / semantic tokens.
4. **Top-20 file sweep** — highest hardcoded-count files first (POS, settings, admin).
5. **Internal Admin decision** — document as light-only **or** add dark admin theme.
6. **Extend or retire global remap** — new code must not depend on `.dark .bg-white` bridge.
7. **Focus-visible audit** — one shared `focusRing` token in `wakaUi`.

**Do not change product identity** — keep warm cream/orange; refine execution, not personality.

**Premium polish score:** **7.0 / 10** — above average SMB POS; below Stripe/Linear dark-mode parity.

---

# 7. Theme Consistency Score

| Category | Score | Weight | Weighted |
|----------|------:|-------:|---------:|
| Light mode quality | 8.1 | 20% | 1.62 |
| Dark mode quality | 6.2 | 25% | 1.55 |
| Component consistency | 5.5 | 20% | 1.10 |
| Accessibility | 6.8 | 15% | 1.02 |
| Enterprise polish | 7.0 | 10% | 0.70 |
| Architecture / tokens | 6.5 | 10% | 0.65 |
| **Overall theme quality** | — | 100% | **6.6 / 10** |

### Enterprise primitive certification

| Component | Result |
|-----------|--------|
| `EnterprisePageContainer` | ✅ Pass |
| `AppModalOverlay` | ✅ Pass |
| `PageHeader` | ⚠️ Partial |
| `SettingsPageHeader` | ⚠️ Partial |
| `PageBackBar` | ⚠️ Partial |
| `WakaSwitch` | ⚠️ Partial |
| `EnterpriseEmptyState` | ⚠️ Partial |
| `EnterpriseSkeleton` | ⚠️ Partial |
| `EnterpriseSaveIndicator` | ⚠️ Partial |
| `EnterpriseListFooter` | ⚠️ Partial |
| `EnterpriseScrollControls` | ⚠️ Partial |

**Passes: 2 · Partials: 9 · Fails: 0** (nothing fully broken; nothing fully certified)

### Vertical dark-mode readiness

| Vertical | Readiness |
|----------|-----------|
| Auth | ✅ Good |
| Settings (appearance) | ✅ Good |
| Inventory wizards | ✅ Good |
| POS / Checkout | ⚠️ Remap-only |
| Settings (other) | ⚠️ Partial |
| Pharmacy / Hospitality | ⚠️ Status color gaps |
| Reports / Analytics | ❌ Charts broken in dark |
| Investigation / Command Center | ❌ Status pastels |
| Enterprise HQ | ⚠️ Remap-only |
| Internal Admin | ❌ Light-only island |

---

## Success Criteria — Current Status

| Criterion | Met? |
|-----------|------|
| No text disappears in either theme | ⚠️ Mostly — chart grids, some captions at risk |
| No hardcoded colors where semantic tokens should be used | ❌ ~500 files in debt |
| Every enterprise primitive fully theme-aware | ❌ 9/11 partial |
| Light and dark equally polished | ❌ Dark significantly behind |
| Consistent premium appearance across modules | ⚠️ Light OK; dark uneven |

**Phase 17.8 certification: NOT COMPLETE** — audit complete; remediation required.

---

## Recommended Phase 17.9 Implementation Order

1. **Status token system** (`statusTokens.ts` + `.dark` pairs) — fixes badges, toasts, KPI chips app-wide.
2. **Chart token system** — fixes reports, command center, analytics.
3. **Enterprise primitive pass** — skeleton, switch, save indicator, empty state.
4. **Top-20 hardcoded file migration** — POS, CloudTrustCenter, admin primitives.
5. **Hospitality floor status colors** — blocked table fix.
6. **Internal Admin theme decision** — document or implement.
7. **Retire `index.html` stale bootstrap** — align with `appTheme.ts`.
8. **Focus-visible token** — accessibility pass.

---

## Appendix — Key Files

```
tailwind.config.ts
src/index.css
src/lib/appTheme.ts
src/context/AppThemeProvider.tsx
src/lib/brandTokens.ts
src/components/ui/wakaPrimitives.tsx
src/components/enterprise/*
src/components/marketing/marketingThemeClasses.ts
src/features/business-analytics/components/AnalyticsCharts.tsx
src/features/investigation-center/lib/activityPresentation.ts
src/lib/hospitality.ts (TABLE_STATUS_COLORS)
```

---

*End of Phase 17.8 read-only audit. No application code was modified.*
