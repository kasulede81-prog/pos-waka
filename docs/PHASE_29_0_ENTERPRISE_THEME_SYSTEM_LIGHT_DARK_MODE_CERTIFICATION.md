# Phase 29.0 — Enterprise Theme System, Light & Dark Mode Certification

**Mode:** Read-only forensic audit (**NO code changes, NO CSS changes, NO theme changes, NO refactoring, NO dependency updates**)  
**Date:** 2026-07-29  
**Scope:** Global WAKA POS theme architecture — Light Mode, Dark Mode, semantic tokens, component adoption, accessibility, theme switching  
**Related prior work:** Phase 17.9 (semantic surfaces), Phase 22.2/22.6 (typography + design-system enforcement), Phase 27–28 (module UX — inherit this system)  
**Next phase:** Focused Phase 29.1 implementation against P0/P1 roadmap below  

---

## Executive Summary

WAKA POS has a **real enterprise theme architecture**: early bootstrap, a single `AppThemeProvider`, HSL CSS variables on `:root` / `.dark`, Tailwind semantic colors, `themeUi` / `statusTokens` / `enterpriseType`, and a design-system scanner. That foundation is stronger than most mid-stage SaaS apps.

It is **not yet certified for full-day retail use** in both themes because:

1. **Status badge contrast is systematically broken** — many `statusTokens` pairs use `text-*-foreground` (often white or near-black) on `bg-*-muted` (pastel / near-same-luminance), failing WCAG AA (~1.1–1.3:1 in several light-mode cases).  
2. **Dark mode surface hierarchy is too flat** — card vs background contrast ≈ **1.10:1**; elevation relies on thin borders (~1.5:1) rather than true layered surfaces. Cashiers will experience “grey stacking.”  
3. **Hard-coded palette bypasses remain widespread** — ~346 `rose-*`, ~326 `emerald-*`, ~392 `amber-*`, ~126 `violet-*` class hits; ~89 `bg-white`; home launcher uses fixed RGBA glows/gradients. Semantic adoption is incomplete.  
4. **Light muted text is only large-text AA** — `muted-foreground` on page/card ≈ **3.96–4.23:1** (fails 4.5:1 for body/caption).  
5. **`themeUi` is under-adopted** (~42 refs) while raw Tailwind semantic classes are heavy (~4.5k) and ad-hoc CTAs/typography still trip `design-system:check` (600+ findings).  
6. **Dark CSS contains duplicate/conflicting utility remaps** — maintenance hazard and evidence of patch-layering rather than token purity.

| Scorecard | Score | Verdict |
|-----------|------:|---------|
| **Light Mode** | **6.8 / 10** | Usable; washed borders + muted text + badge contrast block certification |
| **Dark Mode** | **5.9 / 10** | Readable body text; insufficient elevation / grey stacking |
| **Accessibility** | **5.2 / 10** | Focus rings exist; status/muted/primary text fail AA in multiple paths |
| **Design System architecture** | **7.4 / 10** | Strong spine; dual marketing tokens + bypasses dilute it |
| **Component consistency** | **5.8 / 10** | Primitives good; modules still freestyle colors/type |
| **Theme switching** | **8.2 / 10** | Bootstrap + persistence solid; minor flash/dual-class debt |

**Overall Theme System Readiness: 6.2 / 10**

**Certification decision:** **NOT CERTIFIED** for enterprise full-day Light + Dark operation.

Target after clustered Phase 29.1 (token + status + dark elevation + bypass purge on high-traffic modules):  
**≥ 8.5 Light / ≥ 8.3 Dark / ≥ 8.0 A11y / ≥ 8.5 Design System / ≥ 8.0 Consistency**.

---

## Certification Methodology

1. Map provider → tokens → CSS variables → Tailwind → primitives → modules.  
2. Inventory semantic tokens in `src/index.css` (`:root` / `.dark`) and `tailwind.config.ts`.  
3. Quantify hard-coded / palette bypasses via ripgrep across `src/`.  
4. Compute approximate WCAG contrast for key token pairs (HSL → relative luminance).  
5. Review `themeUi`, `statusTokens`, `enterpriseType`, `WakaButton`, home dashboard theme.  
6. Run `npm run design-system:check` for adoption / legacy signals.  
7. Inspect theme bootstrap, persistence, dual `.dark` + `.marketing-theme-dark`.  
8. Benchmark principles against Stripe / Shopify / Square / Linear / Notion / GitHub / M365 (workflows & hierarchy — not visual clones).

**Not performed:** Live WCAG lab with axe on every route; timed 8-hour cashier wear study; perceptual measurement of OLED black crush on all devices.

---

## PART 1 — Theme Architecture

```text
bootstrapAppThemeClass()          ← src/main.tsx (pre-React paint)
        ↓
AppThemeProvider                  ← src/context/AppThemeProvider.tsx
  preference: system | light | dark
  resolved: light | dark
  persist: localStorage waka-app-theme
        ↓
applyAppThemeClass(resolved)      ← src/lib/appTheme.ts
  html.classList: .dark + .marketing-theme-dark
  html.style.colorScheme
  meta[name=theme-color]
        ↓
CSS Variables                     ← src/index.css :root / .dark
  --background, --card, --primary, status/*, chart/*
  (+ parallel --mkt-* for marketing site)
        ↓
Tailwind semantic colors          ← tailwind.config.ts
  darkMode: ["class", ".dark", ".marketing-theme-dark"]
  stone/slate/gray remapped → semantic (bridge)
  waka.* + brand.* remain fixed hex
        ↓
Token bundles                     ← src/lib/themeTokens.ts (themeUi)
                                  ← src/lib/statusTokens.ts
                                  ← src/lib/enterpriseTypography.ts
        ↓
Shared primitives                 ← WakaButton / WakaCard / WakaInput
                                  ← Enterprise* components
        ↓
Feature modules                   ← POS, Inventory, Reports, Settings, Home, …
```

### Identified layers

| Layer | Location | Role |
|-------|----------|------|
| Theme provider | `AppThemeProvider` | Preference, system media query, cycle/set |
| Color token source | `index.css` HSL channels (no `#` in core tokens) | Single runtime palette |
| CSS variables | `:root`, `.dark`, `--mkt-*` | Surface / status / chart / marketing |
| Semantic Tailwind | `background`, `card`, `muted`, `success`, … | Preferred consumption API |
| Component overrides | `.dark .bg-card`, `.dark input`, shadow remap | Compatibility patch layer |
| Brand primitives | `waka-50…950`, `brand.orange`, `brandTokens.ts` | Fixed orange/cream (intentional) |
| Marketing parallel | `--mkt-*` + `marketing-theme-dark` | Second token family on same class toggle |

### Places colors bypass the design system

| Bypass class | Evidence | Risk |
|--------------|----------|------|
| Tailwind status palettes | rose ~346, emerald ~326, amber ~392, violet ~126 hits | Theme-blind; light/dark drift |
| `bg-white` / `bg-black` | ~89 / ~45 | Breaks dark surfaces / overlays |
| `text-white` | ~441 | Often OK on brand fills; dangerous on muted |
| Hex in TS | ~308 matches / 31 files (brand, print HTML, office hub customColor) | Print OK; UI hex not |
| Home launcher | `homeDashboardTheme.ts` fixed gradients + RGBA glows | Spectacle tiles, not semantic |
| Inline shadows | `shadow-waka*` warm brown RGB in Tailwind | Looks “muddy” / brand-tinted in dark |
| Dual marketing tokens | RGB `--mkt-*` vs HSL app tokens | Two systems to keep in sync |
| `themeUi` underuse | ~42 refs vs ~4.5k semantic class uses | Inconsistent surfaces/buttons |

**Note:** `stone` / `slate` / `gray` scales in Tailwind are **remapped to semantic tokens** (Phase 17.9 bridge). Those class names are not true greyscale hardcodes anymore — but `rose` / `emerald` / `amber` / `violet` / `indigo` are.

---

## PART 2 — Global Color Audit

| Semantic | Light role | Dark role | Consistency | Readability | Contrast notes |
|----------|------------|-----------|-------------|-------------|----------------|
| Background | Warm cream-grey `30 15% 96%` | Near-black `24 10% 7%` | Good | Good | Light/dark body text AAA |
| Surface / Card | `30 20% 99%` | `24 10% 11%` | Good tokens | Dark: merges with bg | Dark card/bg ≈ **1.10:1** |
| Surface elevated | White | `24 10% 14%` | Underused | Dark: still flat | Elevated/bg ≈ **1.20:1** |
| Primary (brand orange) | `25 95% 53%` | Same + brighter hover | Strong brand | Text-on-orange fails AA | Orange on white ≈ **2.78:1** (large UI only) |
| Secondary (green) | Present | Not strongly retuned in `.dark` | Partial | OK as accent | Less audited in modules |
| Muted | Soft fill | Dark grey fill | Good | — | — |
| Muted foreground | `20 8% 48%` | `30 8% 62%` | Good | Light captions weak | Light ≈ **3.96–4.23:1** (AA large only) |
| Border / Divider | `30 12% 87%` | `24 8% 20%` | Good | Low visibility | ~**1.2–1.5:1** vs bg (borders never AA by design; need stronger ΔL in dark) |
| Success / Warning / Danger / Info | Full token families | Retuned muted + fg | Tokens exist | **Badge pairings fail** | See Part 8 |
| Overlay | Dark warm | Pure black | OK | Marketing/app diverge slightly | — |
| Charts | Dedicated tokens | Partial dark retune | Strong for reports | Good | Series colors fixed hues |

**Visual balance:** Light mode leans warm cream + orange (on-brand). Dark mode is cool-neutral brown-grey — acceptable, but **not enough steps between bg → muted → card → elevated** for dense POS tables.

---

## PART 3 — Light Mode Certification

### Surfaces & chrome

| Element | Finding |
|---------|---------|
| Page backgrounds | Warm, comfortable for long sessions; good brand presence |
| Cards | Slightly lifted; border soft — can look washed on cream bg |
| Dialogs | `themeUi.dialog` / Enterprise dialogs — solid pattern when used |
| Tables | `themeUi.tableHead` / row hover exist; adoption uneven |
| Navigation / shell | App shell + launcher gradients; dark remap for launcher exists |
| Forms / inputs | Semantic border/input; 48px min height in `themeUi.input` |
| Chips / badges | Mix of `themeUi.chip` and raw rose/emerald/amber |
| Search / dropdowns / popovers | Generally token-based when enterprise primitives used |
| Tooltips | Not centrally tokenized; risk of one-off colors |

### Light-mode defects

1. **Washed borders** — border/bg ~1.23:1; cards rely on soft shadow (`shadow-waka-sm`) more than edge contrast.  
2. **Low-contrast helper text** — muted-foreground fails normal-text AA.  
3. **Status badges** — white/near-white foreground on pastel muted backgrounds (success/danger/info/offline) ≈ **1.1–1.3:1**.  
4. **Primary-as-text** — orange links/CTAs using primary hue for small text fail AA (large buttons OK).  
5. **Visual clutter risk** — home tiles + multi-hue gradients compete with quiet enterprise density elsewhere.

**Light Mode score: 6.8 / 10** — suitable for casual use; **not** certified for 8–12h professional sessions without token fixes.

---

## PART 4 — Dark Mode Certification

### Hierarchy & elevation

| Check | Result |
|-------|--------|
| True dark hierarchy (bg < muted < card < elevated) | **Weak** — ΔL between steps too small |
| Black crushing | Mild — bg at 7% L avoids pure `#000`; OLED crush risk moderate |
| Grey stacking | **Confirmed** — tables/cards/inputs share similar greys |
| Card separation | Depends on `border-border` (~1.5:1) more than fill |
| Shadows | Remapped to `rgb(0 0 0 / 0.35)` under `.dark` — helps, still soft |
| Overlays | `--overlay: 0 0% 0%` — OK |
| Inputs | Forced card fill + border via `.dark input` — good defensive patch |
| Menus / dialogs | Inherit flat card; elevation gap remains |

### Dark-mode defects

1. **Insufficient elevation** — card/bg **1.10:1**, elevated/bg **1.20:1**. Enterprise dark UIs (Linear, GitHub dark, Stripe) typically keep clearer surface steps.  
2. **Grey stacking on data-dense screens** — Inventory / Reports / Sell grids will visually merge.  
3. **Conflicting utility remaps** — duplicate `.dark .bg-muted` / `.dark .text-foreground` blocks in `index.css` (lines ~846–895) show patch debt; one block temporarily assigns `text-foreground` to `card-foreground`.  
4. **Status success badges** — dark `success-foreground` (L≈10%) on `success-muted` (L≈16%) ≈ **1.24:1** FAIL.  
5. **Brand shadows** — warm orange-tinted `shadow-waka` less coherent on cool dark surfaces.  
6. **Launcher gradient** — forced orange wash may overpower dark calm.

**Dark Mode score: 5.9 / 10** — body text is strong (AAA); **surface system not enterprise-grade**.

---

## PART 5 — Typography

| Role | System | Theme safety |
|------|--------|--------------|
| Display / page / section / body / caption / mono | `enterpriseType` | Uses `text-foreground` / `text-muted-foreground` — theme-safe |
| POS density micro | `text-[10px]` allowlisted | Legibility risk (Phase 28); theme-agnostic |
| Fonts | DM Sans + Roboto (admin) | Loaded in `main.tsx` |
| Enforcement | `design-system:check` fractional-type rule | **Hundreds of violations** still present |

### Findings

- Hierarchy **exists** and is well-designed when used.  
- Captions using `text-muted-foreground` inherit light-mode AA failure.  
- Font weights lean `font-black` / `font-bold` — good for POS glanceability; can feel heavy in Settings prose.  
- Placeholders use muted color — same contrast issue.  
- Line-height: body role uses `leading-relaxed` — good for long sessions when applied.

**Typography verdict:** Structure certified; **contrast + adoption** not certified.

---

## PART 6 — Interactive Components

| Control | Light | Dark | Notes |
|---------|-------|------|-------|
| `WakaButton` primary | Clear orange CTA | Clear | Uses semantic primary |
| Secondary / ghost | Border + card | Ghost uses `dark:text-waka-400` | OK |
| Danger button | Destructive fill | OK | Solid fill contrast OK |
| Focus ring | Global `:focus-visible` + `themeUi.focusRing` | Uses `--ring` orange | **Visible in both** |
| Disabled | `opacity-50` | Same | Predictable; not high-contrast disabled pattern |
| Switch tokens | `themeUi.switchTrackOn` = waka-600 | OK | |
| Hover / pressed | `hover:bg-muted`, `active:` variants | Remapped muted | Generally clear |
| Checkboxes / radios | Native + Tailwind | Dark input rules skip checkbox/radio | Native OS styling may diverge |
| Menus / selects | Mixed enterprise vs ad-hoc | Risk of white popovers | Spot-check needed in 29.1 QA |

**Interaction feedback:** Adequate when primitives used; **unequal** where modules invent local hover colors (`rose`/`emerald` chips).

---

## PART 7 — Data-Dense Screens

| Module | Theme risk | Notes |
|--------|------------|-------|
| **Sell / POS** | High in dark | Dense tiles; 73 palette-bypass hits under `components/pos`; Phase 28 already flagged 12px names |
| **Inventory / Stock** | High | Tables + status chips; inventory components ~41 palette bypasses |
| **Reports** | Medium | Chart tokens help; table elevation weak in dark |
| **Products** | High | Same inventory chip language |
| **Customers** | Medium | Page-level bypass count low; child components vary |
| **Suppliers / Purchasing** | Medium–High | Business workspace adoption ~42% |
| **Dashboard / Home** | Medium | Spectacle gradients; not calm enterprise density |
| **Settings** | Lower | More enterprise primitives; still inherits muted AA issue |

**Long-session comfort:** Light mode fatigue risk = soft borders + bright cream + orange CTAs (manageable). Dark mode fatigue risk = **eye strain from low separation** between rows/cards (higher).

---

## PART 8 — Accessibility

### WCAG contrast (computed from tokens)

| Pair | Ratio | Result |
|------|------:|--------|
| Light bg / foreground | 15.25 | AAA |
| Light muted-fg / bg | 3.96 | **Fail normal AA** (pass large) |
| Light primary / white | 2.78 | **Fail** as text |
| Light success-fg (white) / success-muted | 1.15 | **Fail** |
| Light danger-fg (white) / danger-muted | 1.22 | **Fail** |
| Light info-fg (white) / info-muted | 1.14 | **Fail** |
| Dark bg / foreground | 16.82 | AAA |
| Dark muted-fg / card | 6.45 | AA |
| Dark card / bg | 1.10 | Hierarchy fail (not text) |
| Dark success-fg / success-muted | 1.24 | **Fail** |
| Dark warning-fg / warning (solid) | 1.80 | **Fail** on solid warning chip paths |

### Other a11y checks

| Check | Status |
|-------|--------|
| Color-only communication | **Partial fail** — many status chips are color-only; icons exist in some banners |
| Keyboard focus visibility | **Pass** — global focus-visible ring |
| Error / warning / success visibility | **Fail** where badge text contrast collapses |
| Theme toggle a11y | **Pass** — aria-label via i18n |
| Prefers-color-scheme | **Pass** — `system` preference |

**Accessibility score: 5.2 / 10**

---

## PART 9 — Visual Consistency

| Dimension | Finding |
|-----------|---------|
| Border radius | Tokenized (`--radius` → sm/md/lg/xl/2xl/3xl) — good; modules still mix `rounded-full` chips vs `rounded-xl` |
| Spacing | No single spacing scale enforcement; `space-y-5` custom wrappers flagged by scanner |
| Shadows | `shadow-waka` / `shadow-sm` / raw `shadow-[…]` coexist |
| Elevations | Semantic names exist; dark ΔL too small |
| Buttons | `WakaButton` (~200 refs) vs legacy `bg-waka-600` CTAs (scanner legacy signal) |
| Icon colors | `enterpriseIcons` + ad-hoc `text-rose-600` etc. |

**Unified product feel:** **Partial** — brand orange unifies CTAs; status colors and home gradients fragment the system.

**Component consistency score: 5.8 / 10**

---

## PART 10 — Theme Switching

| Check | Evidence | Status |
|-------|----------|--------|
| Speed | Class toggle on `<html>` — CSS variable swap | Fast |
| Persistence | `localStorage` `waka-app-theme`; migrates legacy marketing key | Pass |
| Flash / hydration | `bootstrapAppThemeClass()` before React paint | Strong |
| System preference | `matchMedia` listener in provider | Pass |
| Dual class | Sets both `.dark` and `.marketing-theme-dark` | Works; dual-system debt |
| Wrong-theme leftovers | Hard-coded `bg-white`, rose/emerald, home RGBA | **Fail** — components stay “light-looking” |
| Transitions | Marketing site transitions 400ms; app shell mostly instant | Acceptable |
| theme-color meta | `#fafaf9` / `#0B0F19` | Pass |
| Tests | `appTheme.test.ts` covers class application | Pass |

**Theme switching score: 8.2 / 10** (mechanism excellent; leftover hardcodes undermine completeness).

---

## PART 11 — Enterprise Benchmark (principles only)

| Principle (Stripe / Shopify / Square / Linear / Notion / GitHub / M365) | WAKA today |
|--------|------------|
| Few semantic surfaces with clear ΔL | Tokens exist; **dark ΔL too small** |
| Status color = text + icon + optional fill, AA always | Tokens exist; **pairings wrong** |
| One button system | `WakaButton` exists; **parallel CTAs remain** |
| Dense tables stay scannable in dark | **At risk** |
| Brand accent reserved for primary actions | Orange used well for CTAs; also in shadows/washes |
| Marketing vs app may differ, but app is calm | Home launcher is loud vs Settings calm |
| Long-session neutrals over saturated fills | Light cream OK; status pastels + multi-hue chips noisy |

WAKA does **not** need to look like Linear — it needs Linear’s **discipline**: token purity, elevation steps, and AA status.

---

## PART 12 — Root Cause Register

| ID | Root cause | Severity | Evidence |
|----|------------|----------|----------|
| **RC-1** | `statusTokens` pairs `*-foreground` with `*-muted` backgrounds | **P0** | Contrast ~1.1–1.3:1 light success/danger/info; dark success ~1.24:1 |
| **RC-2** | Dark surface steps lack luminance separation | **P0** | card/bg 1.10; elevated/bg 1.20; border/bg ~1.5 |
| **RC-3** | Hard-coded Tailwind palettes bypass semantic tokens | **P0** | rose/emerald/amber/violet hundreds of hits; POS/inventory clusters |
| **RC-4** | Light `muted-foreground` below AA for small text | **P0** | 3.96–4.23:1 |
| **RC-5** | `themeUi` / Enterprise primitives under-adopted | **P1** | themeUi ~42 refs; high-traffic adoption ~44%; 600+ scanner findings |
| **RC-6** | Dark mode maintained via utility remap patches | **P1** | Duplicate `.dark .bg-muted` / `.text-foreground` blocks |
| **RC-7** | Dual token families (app HSL vs marketing RGB) | **P1** | `--mkt-*` + both html classes |
| **RC-8** | Fixed brand shadows / home RGBA gradients | **P2** | `shadow-waka`, `homeDashboardTheme.ts` |
| **RC-9** | Primary orange used as small text color | **P2** | 2.78:1 on white |
| **RC-10** | Fractional / ad-hoc typography outside POS density | **P2** | design-system fractional-type violations |
| **RC-11** | Interactive state inconsistency across modules | **P1** | Primitive hover OK; chip/badge freestyle elsewhere |
| **RC-12** | Color-only status in dense tables | **P1** | Badges without icons/text redundancy |

---

## PART 13 — Enterprise Implementation Roadmap

### P0 — Critical (Phase 29.1 must-fix)

1. **Repair `statusTokens` contrast**  
   - On muted backgrounds use saturated `text-success` / `text-danger` / `text-info` (or dedicated `--*-on-muted` tokens), never white-on-pastel.  
   - Re-tune dark `--success-foreground` vs `--success-muted`.  
   - Add contrast unit tests for every status kind × theme.

2. **Rebuild dark elevation scale**  
   - Target approximate steps: bg L≈6–8%, surface L≈12–14%, elevated L≈16–18%, muted L≈10–12%, border L≥22% or alpha hairline + stronger fill delta.  
   - Validate Sell / Inventory / Reports tables in dark.

3. **Raise light muted text**  
   - Darken `--muted-foreground` to ≥4.5:1 on card and background (or split `--text-tertiary` for decorative only).

4. **Purge high-traffic palette bypasses**  
   - Replace rose/emerald/amber/violet in `components/pos`, `components/inventory`, command-center, debts with `statusTokens` / semantic classes.  
   - Ban new `bg-white` in app shell (allow print/export HTML).

### P1 — High

5. Drive `themeUi` + `WakaButton` + Enterprise form/table primitives to ≥80% on high-traffic paths (extend scanner gates).  
6. Collapse dual marketing/app dark application into one resolved theme API (keep marketing visuals, share resolution).  
7. Delete obsolete `.dark` utility remaps once tokens are correct (token purity > patches).  
8. Standardize focus/hover/disabled for checkbox/radio/switch via primitives.  
9. Ensure status always has non-color cue (icon or label) on inventory/POS chips.

### P2 — Medium

10. Theme-aware shadows (neutral dark shadows; keep warm shadow only for brand CTA elevation in light).  
11. Calm home dashboard variants for dark (reduce competing gradients) or isolate “marketing spectacle” from ops home.  
12. Typography cleanup per Phase 22.6 scanner (non-POS fractional sizes).  
13. Document “when to use `waka-*` vs `primary` vs `statusTokens`” in a short token cookbook.

### P3 — Low

14. Optional shop accent / density themes.  
15. High-contrast accessibility theme preference.  
16. Per-module theme QA snapshots (Playwright light/dark).

---

## Deliverable Scores (summary)

| Dimension | Score |
|-----------|------:|
| Light Mode | **6.8 / 10** |
| Dark Mode | **5.9 / 10** |
| Accessibility | **5.2 / 10** |
| Design System | **7.4 / 10** |
| Component Consistency | **5.8 / 10** |
| Theme Switching | **8.2 / 10** |
| **Overall** | **6.2 / 10** |

---

## Success Criteria — Answers

| Question | Answer |
|----------|--------|
| Is Light Mode suitable for full-day professional use? | **Not yet** — usable, but muted text + badge contrast + washed borders fail enterprise bar. |
| Does Dark Mode provide clear hierarchy without sacrificing readability? | **Body text yes; hierarchy no** — surfaces merge; not certified. |
| Which components violate the design system? | Ad-hoc CTAs, rose/emerald/amber chips, home RGBA tiles, legacy page titles, fractional type outside POS, `bg-white` surfaces. |
| Where do hard-coded colors / inconsistent tokens exist? | POS/inventory components, home dashboard theme, brand hex shadows, marketing `--mkt-*` parallel, print HTML (acceptable). |
| Minimum changes for polished enterprise dual-theme? | **P0 cluster:** status token contrast fix + dark elevation retune + muted-foreground AA + high-traffic bypass purge. |

---

## Appendix A — Key file index

| File | Role |
|------|------|
| `src/main.tsx` | `bootstrapAppThemeClass()` |
| `src/context/AppThemeProvider.tsx` | React theme context |
| `src/lib/appTheme.ts` | Persist / resolve / apply classes |
| `src/index.css` | `:root` / `.dark` tokens + dark remaps |
| `tailwind.config.ts` | Semantic colors, bridges, brand scales |
| `src/lib/themeTokens.ts` | `themeUi` bundles |
| `src/lib/statusTokens.ts` | Status badge/banner classes |
| `src/lib/enterpriseTypography.ts` | Type roles |
| `src/components/ui/wakaPrimitives.tsx` | `WakaButton`, `WakaCard`, `WakaInput` |
| `src/components/ui/AppThemeToggle.tsx` | User control |
| `src/config/homeDashboardTheme.ts` | Fixed spectacle gradients |
| `scripts/design-system-enforcement.mjs` | Adoption / legacy scanner |

## Appendix B — Quantitative snapshot (2026-07-29)

| Metric | Value |
|--------|------:|
| Semantic surface/text/border class refs | ~4528 |
| `themeUi` / `wakaUi` refs | ~42 |
| `statusTokens` refs | ~73 |
| `WakaButton` refs | ~200 |
| `dark:` variant refs | ~202 |
| rose / emerald / amber / violet hits | ~346 / ~326 / ~392 / ~126 |
| `bg-white` / `bg-black` | ~89 / ~45 |
| Hex matches in TS/TSX | ~308 (31 files) |
| High-traffic primitive adoption | 29/66 files (44%) |
| Business workspace adoption | 14/33 files (42%) |

---

**Certified by:** Phase 29.0 read-only forensic audit — 2026-07-29  
**Decision:** Theme system architecture **approved as foundation**; Light + Dark **not certified** for enterprise full-day retail until P0 roadmap lands in Phase 29.1.

---

## Phase 29.1 P0 Theme Accessibility & Visual Hierarchy Implementation

**Date:** 2026-07-29  
**Mode:** Surgical implementation (architecture preserved)  
**Scope:** Status token AA contrast, dark elevation, muted-foreground AA, high-traffic palette → semantic tokens  

### Architecture preserved (unchanged)

- `AppThemeProvider`, preference persistence, `bootstrapAppThemeClass`
- HSL token structure + Tailwind semantic mapping
- `WakaButton` API, global focus-visible rings
- No layout / routing / business-logic / typography-scale / radius changes

### Before vs after contrast (computed)

| Pair | Before | After | Result |
|------|-------:|------:|--------|
| Light muted-fg / background | 3.96 | **≥4.5** (`--muted-foreground` L 48→44) | AA |
| Light muted-fg / card | 4.23 | **≥4.5** | AA |
| Light success text / success-muted | 1.15 (white fg) | **≥4.5** (`text-success` on muted; success L→28) | AA |
| Light danger text / danger-muted | 1.22 (white fg) | **≥4.5** | AA |
| Light info text / info-muted | 1.14 (white fg) | **≥4.5** | AA |
| Dark success text / success-muted | 1.24 | **≥4.5** | AA |
| Dark danger text / danger-muted | ~fail | **≥4.5** (danger L→65) | AA |
| Dark card / background | 1.10 | **~1.2+** + stronger border (~2.1) | Hierarchy improved |
| Dark elevated / background | 1.20 | **> card/bg** (elevated L→18) | Clearer stack |

Regression guards: `src/lib/themeContrast.test.ts` (6 tests).

### Updated semantic token mappings

**Light (`:root`)**

- `--muted-foreground: 20 10% 44%`
- `--border` / `--input: 30 14% 82%` (slightly stronger edges)
- `--destructive` / `--danger: 0 72% 45%`
- `--success: 152 72% 28%`, `--info: 199 89% 34%`, `--business: 25 90% 32%`, `--trial: 271 70% 36%`
- `--dialog` distinct near-white surface

**Dark (`.dark`)**

- Stack: `background 6%` → `surface-muted 9%` / `muted 10%` → `card 13%` → `dialog 15%` → `surface-elevated 18%`
- `--border` / `--input: 24 10% 28%`
- Status hues brightened for on-muted text; muted fills deepened (~18% L)

**`statusTokens` pairing (central)**

- Badges/banners: `bg-{kind}-muted` + **`text-{kind}`** (saturated), not `text-{kind}-foreground`
- Warning/pending keep `text-warning-foreground` / `text-pending-foreground` (already dark/light-correct)
- `security` → **trial** semantic (no hard-coded violet)
- `errorStateClasses` titles use `text-danger`

### Dark surface hierarchy changes

| Token | Old L (approx) | New L |
|-------|---------------:|------:|
| `--background` | 7% | 6% |
| `--surface-muted` | 14% | 9% |
| `--muted` | 16% | 10% |
| `--card` | 11% | 13% |
| `--dialog` | (=card) | 15% |
| `--surface-elevated` | 14% | 18% |
| `--border` | 20% | 28% |

Elevation relies on **fill + border steps**, not heavy new shadows.

### Hard-coded palette replacements

- Scripted + manual pass across Sell / Inventory / Stock / Command Center / Home / Customers / PosPage (~**73 files**, ~**382** substitutions).
- Typical maps: `emerald-*`→`success*`, `rose-*`→`danger*`, `amber-*`→`warning*`, `violet-*`→`trial*`, `bg-white`→`bg-card`, `bg-black/N` overlays→`bg-overlay/N`.
- **Intentionally kept:** white/translucent chips on brand-gradient / inverted chrome (DisplayScale, launcher spectacle CTAs).
- Helper: `scripts/phase-29-1-palette-replace.mjs` (one-shot record).

### Accessibility verification

| Check | Status |
|-------|--------|
| Status badges Light/Dark AA | ✅ Token + statusTokens + unit tests |
| Muted text AA | ✅ |
| Focus rings | ✅ Unchanged global `:focus-visible` |
| Solid status fills (white on hue) | ✅ Still ≥4.5 |
| Color-only status | Partial — icons remain on many banners; chips still color-led (P1) |

### Verification commands

```bash
npm run build   # SUCCESS (2026-07-29)
npm test        # themeContrast + statusTokens pass
```

### Unrelated known test failure (not introduced by 29.1)

- `src/lib/pharmacyPatientProfile.test.ts` — `computePatientAge("2000-07-06", new Date("2026-07-06"))` expects 26, receives 25 (calendar/edge DOB logic; unrelated to theme).

### Regression summary

| Area | Result |
|------|--------|
| Theme provider / persistence / bootstrap | Untouched |
| Layout / spacing / radius / typography scale | Untouched |
| Business logic / routing / APIs | Untouched |
| Production build | Pass |
| Theme contrast unit tests | Pass |
| statusTokens unit tests | Updated + pass |

### Manual certification checklist

#### Light Mode

- [ ] Muted text is readable.
- [ ] Status badges are readable.
- [ ] Tables are clear.
- [ ] Cards separate naturally from backgrounds.

#### Dark Mode

- [ ] Cards are visually distinct from the page background.
- [ ] Dense screens no longer appear as a single grey surface.
- [ ] Dialogs are immediately recognizable.
- [ ] Status badges remain readable.

#### Accessibility

- [ ] WCAG AA contrast for normal text.
- [ ] Focus indicators remain visible.
- [ ] Disabled states remain distinguishable.
- [ ] Status colors communicate without reducing readability.

### Phase 29.1 decision

**P0 token + high-traffic application fixes landed.** Architecture remains the certified engine; Light/Dark readability for status, muted text, and dark elevation are now guarded by unit tests. Full enterprise re-score / remaining module palette purge → Phase 29.2 if needed.
