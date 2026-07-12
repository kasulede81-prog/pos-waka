# Phase 22.1 — Enterprise Design System & Visual Language Certification

**Mode:** Read-only forensic design audit (no code changes)  
**Date:** 2026-07-12  
**Scope:** Android, Web, Windows · Hospitality · Pharmacy · Wholesale · Inventory · POS · Internal Admin · Reports · Authentication · Settings · Device Management  
**Baseline reference:** Phase 17.9 Theme Consolidation (semantic tokens, 530+ file migration)

---

## Executive Summary

### Certification verdict

**Does WAKA POS look and feel like an enterprise product designed by a professional design team?**

**Partially — not yet certified.**

WAKA POS has a **credible enterprise design foundation** (semantic color tokens, status system, theme bundles, dark mode runtime, POS display-scale subsystem, documented Phase 17.9 architecture). That foundation compares favorably to early-stage Shopify POS or Toast internal tooling **at the token layer**.

However, **visual execution is inconsistent across modules**. POS touch UI, back-office settings, internal admin v2, auth, marketing, and hospitality/pharmacy verticals each evolved parallel class-string conventions. Shared primitives (`WakaButton`, `WakaCard`, `EnterpriseResponsiveTable`) exist but are adopted in **~3 files each**, while hundreds of screens use inline Tailwind.

The product reads as **a serious B2B POS with strong brand color and competent engineering**, not yet as a **unified premium retail platform** on par with Square POS, Lightspeed, or Stripe Dashboard polish.

| Dimension | Verdict |
|-----------|---------|
| Token architecture | **Certified** (Phase 17.9) |
| Visual language consistency | **Not certified** |
| Component system maturity | **Not certified** |
| Cross-module parity | **Not certified** |
| Enterprise retail benchmark | **Approaching — gaps remain** |

**Overall enterprise design score: 6.3 / 10**

Phase 22.2 should focus on **system-wide primitive adoption and token enforcement**, not isolated screen polish.

---

## Audit methodology

- Read-only inspection of `tailwind.config.ts`, `src/index.css`, `src/lib/themeTokens.ts`, `statusTokens.ts`, `chartTokens.ts`, `brandTokens.ts`, `displayScale/scaleTokens.ts`
- Pattern analysis across 500+ files using `font-black`, radius, button height, and table class conventions
- Module sampling: AppShell, POS/Sell, Command Center, Settings, Internal Admin, Auth, Hospitality, Pharmacy, Reports, Device Management
- Comparison against enterprise benchmarks: Shopify POS, Square, Lightspeed, Toast, Stripe Dashboard, Notion, Google Workspace, Microsoft 365

**Constraints honored:** No code, CSS, Tailwind, migration, or implementation changes in this phase.

---

# Deliverable 1 — Typography Audit

## Canonical definition (exists)

`src/lib/themeTokens.ts` defines semantic bundles:

| Token | Classes |
|-------|---------|
| `heading` | `font-black tracking-tight text-foreground` |
| `subheading` | `font-medium text-muted-foreground` |
| `caption` | `text-xs font-semibold text-muted-foreground` |

Admin uses `font-admin` (Roboto → DM Sans). POS display scale adds `--ds-font-2xs` … `--ds-font-xl` via `scaleTokens.ts`.

## Observed hierarchy (actual usage)

### Page titles — same role, different scales

| Surface | Mobile → desktop | File |
|---------|------------------|------|
| Settings hub | `text-xl sm:text-2xl font-black` | `SettingsHubPage.tsx` |
| Settings subpages | `text-2xl font-black` (no mobile step-down) | `SettingsPageHeader.tsx` |
| Login / staff login | `text-2xl font-black` | `LoginPage.tsx`, `EnterpriseStaffLoginPanel.tsx` |
| AppShell shop header | `text-base sm:text-lg font-black` | `AppShell.tsx` |
| ModalSheet dialog title | `text-xl font-black` | `ModalSheet.tsx` |
| Admin BottomSheet title | `text-base font-black` | `internal-admin/v2/primitives.tsx` |
| Command center section | `text-sm sm:text-base font-black` | `CommandCenterQuickActions.tsx` |
| Internal admin section | `text-sm font-black uppercase tracking-wide` | `adminUi.tsx` |

**Finding:** Settings hub title is *smaller* on mobile than its child pages — inverted hierarchy.

### Eyebrow / caption labels — 7+ sizes for one role

Observed sizes for uppercase section labels and badges:

`text-[8px]` · `text-[9px]` · `text-[10px]` · `text-[11px]` · `text-xs` · `text-sm` · `text-sm uppercase tracking-wide`

Examples:
- `text-[8px] font-black uppercase` — `StockProductCard.tsx` status pills
- `text-[10px] font-black uppercase tracking-widest` — `CommandCenterHealthHero.tsx`
- `text-sm font-black uppercase tracking-wide` — `adminUi.tsx` `AdminShortcut`

### Weight convention drift

| Weight | Typical use | Adoption |
|--------|-------------|----------|
| `font-black` (900) | Headings, buttons, labels, KPIs | **500+ file occurrences** — dominant |
| `font-bold` (700) | Form labels, nav links | Auth, some settings |
| `font-semibold` (600) | Banners, secondary emphasis | Mixed |
| `font-medium` (500) | Subheadings (token) | Underused |

**Finding:** `font-black` is used for almost everything, flattening typographic hierarchy. DM Sans is loaded at 400/700 only — `font-black` may synthesize or fall back, risking inconsistent rendering across platforms.

### Numeric / price rendering

- POS shelf: arbitrary sizes via `posShelfLayout.ts` (`text-[10px]`, `text-[1.65rem]`)
- KPI heroes: `text-2xl font-black`, `text-lg sm:text-2xl lg:text-[1.65rem] font-black`
- Cash entry modals: `text-2xl` / `text-3xl font-black` for amounts
- No shared tabular-nums / price typography token

### Module notes

| Module | Typography assessment |
|--------|----------------------|
| **POS / Sell** | High contrast, heavy weights — appropriate for retail glanceability; fractional sizes proliferate |
| **Auth** | Consistent `text-2xl` titles, `text-sm font-bold` labels — best-in-app coherence |
| **Settings** | Hub vs leaf mismatch; forms mix 44px/48px fields with different label weights |
| **Internal Admin** | Roboto admin font helps separation; micro-labels at 10–11px dense but inconsistent with POS |
| **Reports / Receipts** | Card-based history uses hero metrics well; filter chips vary in size |
| **Hospitality / Pharmacy** | Inherits POS patterns; pharmacy adds teal chrome without typography differentiation |

### Typography certification

| Criterion | Status |
|-----------|--------|
| Defined scale | Partial (Tailwind defaults + POS `--ds-font-*`) |
| Enforced hierarchy | **No** |
| Enterprise-grade consistency | **No** |
| Numeric clarity | Partial |

**Typography score: 5.5 / 10**

---

# Deliverable 2 — Design Token Audit

## Token sources (multi-layer)

```
localStorage (waka-app-theme)
    → AppThemeProvider / bootstrapAppThemeClass
    → CSS variables (:root / .dark) — src/index.css
    → tailwind.config.ts semantic mappings
    → themeTokens.ts / statusTokens.ts / chartTokens.ts / brandTokens.ts
    → Components (inline Tailwind — often bypasses bundles)
```

Parallel systems:
- **App HSL semantics** — primary enterprise path
- **Marketing RGB** — `--mkt-*` in `index.css`
- **Brand hex scale** — `waka-50`…`waka-950` in Tailwind
- **Home dashboard tiles** — hardcoded gradients in `homeDashboardTheme.ts`
- **POS display scale** — runtime `--ds-*` variables
- **Lovable import** — separate Tailwind v4 `@theme` stack (not wired to main app)

## Spacing

| Source | Coverage |
|--------|----------|
| Tailwind default scale | Full 4px grid |
| Custom spacing scale in config | **None** |
| Layout CSS vars | `--waka-bottom-nav-h`, `--waka-safe-*`, scroll-tail calcs |
| POS scale | `--ds-gap-1` … `--ds-gap-4` |

**Magic numbers (high frequency):** `min-h-[44px]`, `min-h-[48px]`, `min-h-[52px]`, `rounded-t-[1.75rem]`, `pb-[calc(var(--waka-bottom-nav-h)+…)]`, `z-[55]`, `z-[100]`

## Radii

Base: `--radius: 0.875rem` → derived `rounded-sm` through `rounded-3xl`.

**Drift:** `rounded-[28px]`, `rounded-[1.75rem]`, `rounded-[1.35rem]` appear in cards and auth surfaces outside the derived scale.

## Shadows

Tokenized: `shadow-waka`, `shadow-waka-sm`, `shadow-mkt`.

**Drift:** `shadow-sm`, `shadow-lg`, `shadow-2xl`, arbitrary `shadow-[0_16px_48px_rgba(...)]` on home tiles and checkout FAB.

## Motion

| Token | Value |
|-------|-------|
| `transition-waka` | 180ms, cubic-bezier(0.22, 1, 0.36, 1) |
| Display scale | 200ms |
| Marketing | 400–500ms |
| `pin-shake` | 0.4s |

No centralized duration/easing scale in Tailwind config.

## Duplication examples

| Item | Locations |
|------|-----------|
| Primary orange | `--primary`, `waka-600`, `brand.orange`, `--business` |
| Danger | `danger` = `destructive` (alias) |
| Brand shadow | `tailwind.config.ts` + `brandTokens.ts` |
| Button styles | `themeUi.btnPrimary` + `.waka-btn-primary` in `index.css` |
| Broken classes | `text-waka-` / `bg-waka-` without shade in marketing files |

## Token certification

| Criterion | Status |
|-----------|--------|
| Semantic foundation | **Strong** (Phase 17.9) |
| Single source of truth | **No** — 4+ parallel color systems |
| Spacing/type/motion scales | **Incomplete** |
| Magic number density | **High** in POS and sheets |

**Design tokens score: 7.0 / 10**

---

# Deliverable 3 — Color System

## Semantic palette (certified layer)

Defined in `index.css` + mapped in `tailwind.config.ts`:

| Role | Tokens |
|------|--------|
| Primary | `--primary`, `--primary-hover`, `--primary-foreground` |
| Secondary | `--secondary` (green accent) |
| Success / Warning / Danger / Info | Full foreground + muted variants |
| Neutral | Via `muted`, `border`, `surface-*` (no 50–950 neutral scale) |
| Surface | `background`, `card`, `surface`, `surface-elevated`, `surface-muted`, `dialog` |
| Disabled | `--disabled`, opacity utilities |
| Domain status | `trial`, `expired`, `offline`, `syncing`, `paid`, `vip`, etc. |

`statusTokens.ts` centralizes badge/banner/dot classes — **good enterprise pattern**.

## Dark mode

- Selector: `darkMode: ["class", ".dark", ".marketing-theme-dark"]`
- Token overrides in `.dark` block
- Legacy bridge remaps `.dark .bg-card`, `.dark .text-muted-foreground` — indicates incomplete migration

## Accessibility & contrast

| Area | Assessment |
|------|------------|
| Focus rings | Tokenized (`--ring`, `themeUi.focusRing`) |
| Text on primary | `primary-foreground` on `waka-600` — generally adequate |
| Muted captions at 8–10px | **Risk:** small size hurts readability regardless of contrast ratio |
| Module accent colors | Teal pharmacy, red exit bar, violet admin actions — functional but not token-unified |
| Color-only status | Badges often pair color + text — acceptable |

## Drift from enterprise consistency

- CTAs frequently use `bg-waka-600` instead of `bg-primary`
- Home dashboard tiles use raw Tailwind palette (`emerald-500`, `fuchsia-500`)
- Bottom chrome: orange (hospitality), teal (pharmacy), red (module exit) — three accent systems for navigation

**Color system score: 7.5 / 10**

---

# Deliverable 4 — Component Consistency

## Shared primitives (exist, under-adopted)

| Primitive | Location | Adoption |
|-----------|----------|----------|
| `WakaButton` / `WakaCard` / `WakaInput` | `ui/wakaPrimitives.tsx` | **3 files** |
| `themeUi.*` bundles | `themeTokens.ts` | Partial — enterprise pages, some admin |
| `ModalSheet` | `layout/ModalSheet.tsx` | ~35 files |
| `ConfirmationDialog` | Standard footer on ModalSheet | Rare reuse |
| `EnterpriseResponsiveTable` | `ResponsiveDataTable.tsx` | **3 files** |
| `EnterpriseSkeleton` | `enterprise/EnterpriseSkeleton.tsx` | Inconsistent vs ad-hoc loaders |
| `EnterprisePinPad` | Auth + staff flows | Good reuse |
| `WakaSwitch` | Enterprise settings | Partial |

## Button families (~12 distinct patterns)

| Pattern | Height | Radius | Example |
|---------|--------|--------|---------|
| themeUi primary | 44px | xl | `ConfirmationDialog` |
| POS modal footer | 52px | 2xl | `ShiftCloseModal` |
| Auth submit | 52px | xl | `LoginPage` |
| Google OAuth | 52px | 2xl | `GoogleSignInButton` |
| Admin standard | 44px | xl | `primitives.tsx` |
| Admin compact | 36px | xl | `ShopConsoleLayout` |
| POS large CTA | 56px | 2xl–3xl | `ShiftOpeningScreen`, `PosPage` |
| Pill tabs | 40–44px | full | `DateFilterBar`, admin filters |
| Color one-offs | varies | varies | violet, teal, rose, amber CTAs |

## Cards (~8 radius/border families)

| Pattern | Radius | Example |
|---------|--------|---------|
| themeUi.surface | 2xl | Standard enterprise |
| Command center | 3xl | Dashboard widgets |
| Living home tile | 28px arbitrary | Launcher |
| Auth card | 1.75rem | Login |
| Hero metric strip | 1.35rem + gradient | History/receipts |
| Admin AdminCard | 2xl + shadow-sm | Internal admin |

## Dialogs (4 patterns)

1. **ModalSheet** — `text-xl` title, standardized chrome
2. **AppModalOverlay** — hand-rolled, ~45 files
3. **BottomSheet** (framer-motion) — admin v2, `text-base` title
4. **Custom domain sheets** — stock, pharmacy, hospitality

## Inputs (~5 families)

Standard 48px / `rounded-xl` / 1px border vs POS numeric 52–72px / `rounded-2xl` / `border-2` / large type.

## Badges

Three named components + inline variants from 8px to 12px for the same pill shape.

**Components score: 5.0 / 10**

---

# Deliverable 5 — Density Audit

## Breakpoint contract

`responsiveBreakpoints.ts`: mobile ≤767 · tablet 768–1023 · desktop ≥1024

**Critical drift:** `usePosDesktopLayout` fires at **768px (md)**, while `HeaderBackButton` visibility uses **`lg:` (1024px)**. Tablet band gets desktop layout logic without desktop header back affordance.

## Density by form factor

| Form factor | Density | Whitespace | Scrolling |
|-------------|---------|------------|-----------|
| **Phone** | High on POS (product grid); moderate on settings | Bottom nav + safe-area padding handled via CSS vars | `MobileScrollTail`, scroll-tail calcs — good |
| **Tablet** | Ambiguous — desktop POS layout without full desktop chrome | EnterprisePageContainer nav padding drops at md+ | Horizontal scroll on admin mobile tabs |
| **Desktop** | POS enterprise mode maximizes catalog + checkout columns | Generous on command center (`rounded-3xl` cards) | Tables often overflow-x without card fallback |

## Enterprise density vs retail usability

- **POS Sell:** Appropriate retail density — large touch targets, glanceable prices
- **Back office:** Often too sparse (large cards, low information per screen) compared to Stripe Dashboard or Lightspeed admin
- **Internal admin:** Good ops density on shop console; mixed on list pages (cards vs tables)

**Density score: 6.0 / 10** (context-appropriate in POS; inconsistent elsewhere)

---

# Deliverable 6 — Iconography

## Icon family

- **Primary:** Lucide React (~200+ files)
- **Brand:** `WakaSymbolIcon` / `WakaPosLogo` (`WakaLogo.tsx`)
- **OAuth:** Inline Google SVG

## Size tiers (no shared map)

| Size | Use |
|------|-----|
| `h-3 w-3` | Dense status strips |
| `h-3.5 w-3.5` | Card icons |
| `h-4 w-4` | Inline field icons, back nav |
| `h-5 w-5` | Modal close, admin header |
| `h-7–8 w-8` | FAB, empty states |

## Stroke & alignment

- Default Lucide stroke (2)
- `strokeWidth={2.25}` on select components (`OfficeNavCard`, `FloatingSupportFab`)
- `WakaSymbolIcon` size prop frequently overridden with `!h-* !w-*` — size system undermined

## Status & navigation icons

Status icons via `statusTokens.ts` — **consistent**. Navigation icons vary by module accent color, not by icon token.

**Iconography score: 6.5 / 10**

---

# Deliverable 7 — Navigation

## Systems inventory

| Pattern | Where | Notes |
|---------|-------|-------|
| AppShell header + menu drawer | Global | Shop name, user menu, language — header controls at 38px (below touch standard) |
| Bottom navigation | Hospitality, pharmacy, module exit | 52px height; **3 accent colors** |
| Desktop horizontal nav | Pharmacy, POS ops | Appears at 768px+ |
| PageBackBar | Enterprise/settings pages | `themeUi.backLink` 44px |
| HeaderBackButton | AppShell | Hidden until lg (1024px) |
| HeaderExitButton | Desktop terminal | 38px → 44px at lg |
| Internal Admin shell | Portaled full-screen | Separate tab + sidebar model |
| EnterpriseShell pill nav | Multi-branch enterprise | 40px height — below standard |
| HorizontalTabBar | Some modules | Stone/black active state — differs from waka-orange tabs |

## Consistency assessment

- **Wayfinding logic is sound** — users can navigate all modules
- **Visual and behavioral consistency is not** — four back-navigation implementations, three bottom chrome palettes, breakpoint mismatch on tablet

**Navigation score: 6.0 / 10**

---

# Deliverable 8 — Motion System

## Canonical motion

- `transition-waka` — 180ms unified easing
- `animate-pulse` — skeleton standard (`themeUi.skeleton`)
- `animate-pin-shake` — PIN error feedback
- `active:scale-[0.97–0.98]` — touch press on pin pad, exit bar

## Inconsistencies

| Pattern | Where |
|---------|-------|
| `transition-colors` only | Many buttons — no transform/opacity |
| `Loader2 animate-spin` | Admin shell, internal pages |
| Custom border spinners | Device activation, auth callback, Google sign-in |
| framer-motion | Admin v2 BottomSheet, KPI pulse — **admin-only** |
| Domain skeletons | `SalesHistorySkeletonList`, `ProfitSkeleton` — not `EnterpriseSkeleton` |

Dialogs: ModalSheet uses CSS transitions; admin BottomSheet uses framer-motion — **different feel**.

**Motion score: 5.5 / 10**

---

# Deliverable 9 — Forms

## Canonical (`themeUi.input`)

`min-h-[48px] rounded-xl border border-input px-4 text-base transition-waka`

## Observed families

| Context | Field pattern |
|---------|---------------|
| Login | 48px, `rounded-xl`, `text-sm font-bold` labels |
| Shop profile settings | 44px, `px-3 py-2.5` — not themeUi |
| POS cash/count | 52–72px, `rounded-2xl border-2`, `text-2xl–3xl font-black` |
| Admin forms | 48px — closest to standard |
| Hospitality config | 44px or 40px mixed |

## PIN / password

- `EnterprisePinPad` — band-aware heights (40/44/48px), shake animation, `role="alert"` errors — **strong**
- Staff recovery setup — ModalSheet + pin pad + optional password — consistent with auth

## Validation presentation

Errors: inline red banners, `role="alert"`, modal footers — no unified form error component.

**Forms score: 6.0 / 10**

---

# Deliverable 10 — Tables vs Cards

## Canonical pattern

`EnterpriseResponsiveTable`: desktop `.waka-data-table` at `sm+`; mobile card list at `<sm`.

**Adopted in 3 files.** Most data views bypass it.

## Current state by domain

| Domain | Pattern | Appropriate? |
|--------|---------|--------------|
| Receipts / sales history | Virtualized cards | **Yes** — mobile-first history |
| Stock / inventory | Product tiles/grid | **Yes** — visual SKU browsing |
| Open shifts, compliance, admin releases | Raw `<table>` scroll | **No** — needs responsive fallback |
| Internal admin shops/devices | Cards | **Yes** for scanability |
| Internal admin audit (partial) | ResponsiveDataTable | **Yes** — underused model |
| Reports (pharmacy margin) | Card lists | Acceptable for summary reports |
| Enterprise financial diagnostics | Manual table/card split | Good pattern, duplicated not shared |

## Recommendation direction (for 22.2)

- **Cards:** launcher, history, fleet, shop lists, product browse
- **Compact lists:** settings toggles, staff pickers, filter results
- **Enterprise tables:** shifts, compliance registers, audit logs, release management, growth campaigns

**Tables score: 4.5 / 10** · **Cards score: 6.0 / 10**

---

# Deliverable 11 — Mobile Audit

## Strengths

- `h-dvh max-h-dvh` viewport locking in AppShell
- Safe-area via `--waka-safe-bottom/top` and extensive `env(safe-area-inset-*)` usage
- Bottom nav height variables feed scroll padding and fixed footers
- `MobileScrollTail` for iOS scroll behavior
- `touch-manipulation` on pin pad and bottom nav
- POS overlay full-screen checkout with safe-area padding

## Weaknesses

| Issue | Impact |
|-------|--------|
| Touch targets 34–40px in places | Below WCAG 2.5.5 advisory 44px |
| Settings pages use `pb-8` without `EnterprisePageContainer` | Risk of content hidden behind bottom chrome |
| Fractional typography (8–10px) | Hard to read on small phones |
| Landscape | Limited explicit landscape optimization |
| Thumb zones | Primary CTAs generally bottom-aligned on POS — good; header actions at top — acceptable |

## Vertical modules

- **Hospitality:** Floor plan tabs + bottom nav — workable; dense on small phones
- **Pharmacy:** Teal mobile nav consistent; dispense overlay mirrors POS — good

**Mobile UX score: 6.5 / 10**

---

# Deliverable 12 — Desktop Audit

## Strengths

- POS enterprise mode: multi-column catalog + checkout dock
- Internal admin: responsive max-width ladder (`max-w-2xl` → `2xl:max-w-7xl`)
- Collapsible admin sidebar at md+
- Keyboard: PIN pad and form focus rings present
- Hover states on desktop nav and table rows (where `.waka-data-table` used)

## Weaknesses

| Issue | Impact |
|-------|--------|
| Tablet band (768–1023) | Desktop layout without full desktop chrome |
| Tables without horizontal scroll discipline | `min-w-[520px]` forces scroll on narrow desktop |
| Ultra-wide | Max-width caps center content — acceptable but underuses space on ultra-wide |
| Hover inconsistency | Some buttons use `transition-colors` only |
| Multi-panel | Investigation center and command center approach enterprise patterns; settings remain single-column |

**Desktop UX score: 6.0 / 10**

---

# Deliverable 13 — Visual Branding

## Recognizable WAKA identity

| Element | Assessment |
|---------|------------|
| **Color personality** | Warm cream background + WAKA orange — **distinctive**, not generic SaaS blue |
| **Typography** | DM Sans + heavy weights — modern African retail energy; overused `font-black` reduces refinement |
| **Corner language** | Leans soft (`rounded-2xl`/`3xl`) — friendly, on-brand for SMB retail |
| **Spacing** | Generous — approachable, slightly less “premium enterprise” than Stripe |
| **Icon language** | Lucide + custom WAKA symbol — adequate |
| **Trust / professionalism** | Diagnostics, enterprise security, internal admin convey seriousness |
| **Memorability** | **Moderate** — color brand is strong; layout patterns are less unique |

## vs generic component-library software

WAKA does **not** look like unmodified shadcn/ui. It has brand color, custom shell, domain modules, and status token system. It **does** look like a product that grew fast with **Tailwind utility composition** rather than a Figma-first design team enforcing one component spec.

**Branding score: 7.0 / 10** · **Enterprise feel score: 5.5 / 10**

---

# Deliverable 14 — AI Fingerprint Audit

Patterns that reduce perceived product quality (common in AI-assisted / utility-first development):

| Pattern | Evidence | Why it hurts | Enterprise contrast |
|---------|----------|--------------|---------------------|
| **Universal `font-black`** | 500+ files | Flattens hierarchy; everything shouts | Square/Shopify use 2–3 weight levels deliberately |
| **Identical card recipe** | `rounded-2xl border border-border bg-card p-4 shadow-sm` repeated | Monotonous grid of same boxes | Stripe uses density tiers and table/list/card switching |
| **Fractional text sizes** | `text-[8px]`–`text-[11px]` | Suggests pixel-pushing not scale | Design systems use named steps only |
| **Multiple button heights for same intent** | 36–56px | Feels assembled not designed | One primary height per context (touch vs desktop) |
| **Parallel dialog implementations** | ModalSheet + AppModalOverlay + BottomSheet | Inconsistent title size, footer, motion | Single dialog primitive with variants |
| **Default Tailwind shadows on branded surfaces** | `shadow-sm` alongside `shadow-waka-sm` | Subtle “template” feel | Single elevation scale |
| **Placeholder gradient hero cards** | `HistoryHeroCard`, home tiles | Marketing-site aesthetic inside ops app | Operations tools use data density over decoration |
| **Module accent color drift** | Orange / teal / red / violet CTAs | Looks like features added separately | One accent + semantic status colors |
| **Low primitive adoption despite docs claiming 9.9/10 theme** | WakaButton in 3 files | Documentation ahead of execution | Certified DS = enforced lint + adoption |
| **Copper-bottom safe-area calcs copy-pasted** | 18+ bottom sheets | Maintenance smell | Shared footer primitive |
| **Broken token references** | `text-waka-` without shade in marketing | Sloppy output signal | QA gate on class names |

---

# Deliverable 15 — Enterprise Design Score

| Category | Score (/10) | Notes |
|----------|-------------|-------|
| Typography | 5.5 | Tokens exist; hierarchy not enforced; weight overload |
| Color System | 7.5 | Strong semantics; primary drift and module accents |
| Design Tokens | 7.0 | Phase 17.9 foundation; incomplete scales; magic numbers |
| Components | 5.0 | Primitives defined; ~12 button families; low adoption |
| Tables | 4.5 | Responsive table barely used |
| Cards | 6.0 | Consistent recipe but too many radii variants |
| Navigation | 6.0 | Functional; 4 back systems; chrome color split |
| Mobile UX | 6.5 | Safe area strong; touch targets uneven |
| Desktop UX | 6.0 | Tablet band gap; table overflow |
| Accessibility | 6.0 | Focus tokenized; small text risk; touch target gaps |
| Branding | 7.0 | Distinctive orange/cream; execution varies |
| Enterprise Feel | 5.5 | Not yet Square/Shopify/Stripe tier polish |

### **Overall score: 6.3 / 10**

**Certification status: NOT CERTIFIED for enterprise visual language**

**Token layer: CERTIFIED (inherits Phase 17.9)**  
**Visual execution layer: REQUIRES Phase 22.2**

---

# Deliverable 16 — Phase 22.2 Blueprint

System-wide improvements only. No isolated screen redesigns.

## P0 — Must fix before production certification

| # | Initiative | Rationale |
|---|------------|-----------|
| 1 | **Enforce primitive adoption gate** | Migrate primary actions to `WakaButton` / `themeUi.btnPrimary|Secondary`; block new inline `bg-waka-600 min-h-[…]` via lint or codemod |
| 2 | **Typography scale lock** | Define 6 roles: Display, PageTitle, SectionTitle, Body, Label, Caption — map to Tailwind classes; ban `text-[8–11px]` outside POS shelf density mode |
| 3 | **Two-tier touch system** | Standard 44px (admin/settings) + POS 52px (sell/cash/modals) — document and enforce; eliminate 36–40px interactive controls on mobile |
| 4 | **Breakpoint alignment** | Resolve 768 vs 1024: either move `usePosDesktopLayout` to 1024 or show `HeaderBackButton` at md; fix tablet band |
| 5 | **Unified back navigation** | Single `EnterpriseBackControl` replacing PageBackBar, SettingsPageHeader back, HeaderBackButton, HeaderExitButton variants |
| 6 | **EnterpriseResponsiveTable rollout** | Migrate P0 data views: open shifts, compliance registers, finance diagnostics, release management, growth campaigns |
| 7 | **Settings page container** | All settings leaf pages use `EnterprisePageContainer` for nav/safe padding consistency |
| 8 | **Fix broken marketing token classes** | `text-waka-*` / `bg-waka-*` incomplete references |

## P1 — High-value improvements

| # | Initiative | Rationale |
|---|------------|-----------|
| 9 | **Dialog consolidation** | Deprecate raw `AppModalOverlay` footers; extend `ModalSheet` + `ConfirmationDialog` as only dialog API |
| 10 | **Form field primitive** | `EnterpriseTextField` wrapping `themeUi.input`; POS numeric variant for cash/count |
| 11 | **Card radius lock** | Standard card = `rounded-2xl` (themeUi.surface); hero = `rounded-3xl` max; ban arbitrary `[28px]` |
| 12 | **Bottom chrome unification** | One nav shell component; module accent via icon/badge not entire bar color |
| 13 | **Icon size map** | `icon-xs/sm/md/lg` wrapper over Lucide; fix WakaSymbolIcon override pattern |
| 14 | **Loading state standard** | `EnterpriseAsyncShell` + `EnterpriseSkeleton` everywhere; ban bespoke spinners except auth bootstrap |
| 15 | **Primary color unification** | CTAs use `bg-primary` not `bg-waka-600`; keep `waka-*` for brand marketing only |
| 16 | **Badge / status size lock** | One compact (10px) + one default (12px) badge size via `statusTokens` |

## P2 — Polish

| # | Initiative | Rationale |
|---|------------|-----------|
| 17 | **Motion token scale** | `duration-fast (120ms)`, `duration-normal (180ms)`, `duration-slow (300ms)` + shared easing |
| 18 | **Elevation scale** | `elevation-0..3` replacing shadow-sm/lg/waka mix |
| 19 | **Tab primitive** | Unify HorizontalTabBar, admin tabs, filter pills |
| 20 | **Price / numeric typography** | `font-tabular-nums` + `--type-price-lg` for POS and reports |
| 21 | **Dark mode bridge removal** | Complete migration; delete `.dark .bg-card` remaps |
| 22 | **Admin framer-motion parity** | Either extend motion to enterprise modals or simplify admin to CSS transitions |
| 23 | **Receipt / print typography** | Separate compact print scale |

## P3 — Future enhancements

| # | Initiative | Rationale |
|---|------------|-----------|
| 24 | **Figma ↔ code token sync** | Single export pipeline for design team |
| 25 | **Tailwind v4 `@theme` migration** | Consolidate with lovable-import stack |
| 26 | **Density preference** | User/shop setting: compact / comfortable / touch (extends display scale) |
| 27 | **Windows native chrome** | Title bar / snap layout integration |
| 28 | **Landscape POS layout** | Dedicated horizontal shelf layout |
| 29 | **CI visual regression** | Chromatic or Percy on command center, POS, admin |
| 30 | **Accessibility certification pass** | WCAG 2.2 AA formal audit |

---

## Regression checklist (Phase 22.2 entry criteria)

Use this checklist to re-run certification after implementation:

- [ ] `WakaButton` used for >80% of primary/secondary actions (excluding POS keypad)
- [ ] Zero `text-[8px]`–`text-[11px]` outside POS display-scale module
- [ ] All settings pages wrapped in `EnterprisePageContainer`
- [ ] All data tables use `EnterpriseResponsiveTable` or documented exception
- [ ] Single back-navigation component across AppShell and settings
- [ ] Tablet band (768–1023) navigation behavior documented and consistent
- [ ] No inline `bg-waka-600` on enterprise screens — `bg-primary` only
- [ ] Dialog titles use one scale per container type
- [ ] Loading states use `EnterpriseSkeleton` family
- [ ] Bottom nav one visual system across hospitality/pharmacy/generic

---

## Verification matrix

| Audit area | Primary evidence files |
|------------|------------------------|
| CSS tokens | `src/index.css`, `tailwind.config.ts` |
| Theme bundles | `src/lib/themeTokens.ts`, `statusTokens.ts` |
| Primitives | `src/components/ui/wakaPrimitives.tsx`, `layout/ModalSheet.tsx` |
| Responsive table | `src/components/shared/ResponsiveDataTable.tsx` |
| Breakpoints | `src/lib/responsiveBreakpoints.ts`, `hooks/usePosDesktopLayout.ts` |
| App shell | `src/components/layout/AppShell.tsx`, `lib/enterpriseBottomChrome.ts` |
| POS density | `src/lib/displayScale/scaleTokens.ts`, `lib/posShelfLayout.ts` |
| Admin shell | `src/components/internal-admin/v2/AdminShell.tsx` |
| Prior theme cert | `docs/PHASE_17_9_ENTERPRISE_THEME_CONSOLIDATION.md` |

---

## Conclusion

WAKA POS is **past the “default Tailwind app” stage** and has **invested correctly in semantic tokens and enterprise theme architecture (Phase 17.9)**. That investment is necessary but **not sufficient** for enterprise visual certification.

The gap between WAKA and Shopify POS / Square / Stripe Dashboard is not primarily color or dark mode — it is **enforcement**: one typography scale, one button spec per context, one dialog, one table strategy, one navigation language, and primitives used everywhere instead of copied utility strings.

**Phase 22.2 should be an enforcement and primitive-adoption phase**, not a redesign. Success means a developer cannot easily ship a new screen that looks unlike the rest of the product.

---

*Phase 22.1 — Read-only certification complete. No code changes made.*
