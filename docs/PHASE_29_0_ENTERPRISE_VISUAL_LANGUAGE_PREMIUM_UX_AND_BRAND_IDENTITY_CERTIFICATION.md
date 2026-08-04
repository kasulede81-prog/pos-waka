# Phase 29.0 — Enterprise Visual Language, Premium UX & Brand Identity Certification

**Mode:** Read-only forensic audit (**NO code changes, NO CSS changes, NO SQL, NO migrations, NO dependency updates**)  
**Date:** 2026-08-03  
**Scope:** Global WAKA POS visual language — typography, spacing, surfaces, cards, buttons, dashboards, landing, brand identity, premium feel  
**Related prior work:**  
- Phase 22.1–22.6 (design system baseline, enforcement, adoption, polish)  
- Phase 29.0/29.1 **Theme System** (`PHASE_29_0_ENTERPRISE_THEME_SYSTEM_LIGHT_DARK_MODE_CERTIFICATION.md`) — color tokens, Light/Dark contrast, status AA (do **not** re-litigate here)  
**Next phase (recommended):** Phase 29.1 **Visual Language tokens & primitives** — one foundational pass that lifts hundreds of screens  

---

## Reference materials note

The prompt references **three attached videos** as visual inspiration only.  
**No video files were available in the workspace or chat attachments at audit time** (searched `*.mp4|mov|webm|mkv` under the repo and Cursor project folder).

This certification therefore:

1. Treats “premium reference” as **industry principles** commonly demonstrated by calm enterprise product UIs (Stripe Dashboard, Linear, Shopify Admin, Square Dashboard, Notion, GitHub — **principles only, never layout/brand clones**).  
2. Grounds every WAKA finding in **repo forensics** (components, tokens, scanner metrics).  
3. Explicitly forbids copying any external product’s layout, illustration language, or branding.

If the three videos are provided later, a short **addendum** can map each extracted principle to a timestamp without changing the roadmap below.

---

## Executive Summary

WAKA POS already owns a **real enterprise design spine**: six typography roles, `themeUi` surfaces, `WakaButton` / `EnterpriseCard` / `EnterpriseKpiCard`, motion helpers, and a live design-system scanner. Phase 29.1 theme work improved color contrast and dark elevation.

It is **not yet certified as a unified premium visual language** because:

1. **Typography roles exist but are under-adopted** — `font-black` (~2258 hits) and fractional `text-[Npx]` (~618 / 549 scanner violations) still define most of the UI; `<PageTitle>` has **0** production usages.  
2. **No documented spacing scale** — empirical rhythm is `gap-2` / `px-3` / `p-4`, but modules freestyle (`gap-1` POS vs `p-6` hospitality vs `space-y-5` leftovers).  
3. **Card system is duplicated** — `rounded-2xl border` ≈ **778** ad-hoc recipes vs sparse `EnterpriseCard` / dead `WakaCard` (0 JSX).  
4. **Button system is split** — `WakaButton` JSX ~67 vs inline `bg-waka-600` **226**; three height ladders (44 / 48 / 52).  
5. **Dashboard rhythm is bifurcated** — Command Center/reports feel enterprise-calm; home launcher + hospitality feel marketing-spectacle.  
6. **Landing Light Mode loses brand hierarchy** — truncated classes like `bg-waka-` / `text-waka-` (missing shade numbers) in `marketingThemeClasses.ts` weaken CTA and accent contrast on cream/white.  

| Scorecard | Score | Verdict |
|-----------|------:|---------|
| **Mobile visual UX** | **6.4 / 10** | Dense POS works; type/spacing inconsistency shows at small widths |
| **Tablet visual UX** | **6.8 / 10** | Split panes help; card/KPI recipes still diverge |
| **Desktop visual UX** | **7.1 / 10** | CC/reports strongest; home spectacle vs ops calm |
| **Typography** | **5.9 / 10** | System designed; adoption weak |
| **Spacing** | **5.5 / 10** | No scale; crowded vs airy modules |
| **Card system** | **5.4 / 10** | Primitive exists; duplication dominates |
| **Light theme (visual hierarchy)** | **6.6 / 10** | Theme AA improved (29.1); VL hierarchy still soft on marketing + washed cards |
| **Dashboard rhythm** | **6.2 / 10** | Split personality CC vs home/hospitality |
| **Landing page** | **5.0 / 10** | Broken `waka-` shade classes; parallel token system |
| **Accessibility (VL aspects)** | **7.0 / 10** | Touch mins mostly ≥44; type fractionals hurt POS legibility (Phase 28) |
| **Premium feel** | **6.0 / 10** | Capable foundation; inconsistent application kills “one product” calm |

**Overall Visual Language / Premium UX Readiness: 6.1 / 10**

**Certification decision:** **NOT CERTIFIED** as a world-class unified enterprise visual language.  
**Architecture decision:** **APPROVED** — do not invent a new design engine; drive Phase 29.1 on **tokens + primitives adoption**.

Target after a scoped Phase 29.1 (type + spacing + card/button primitives on high-traffic + marketing shade fix):  
**≥ 8.2 typography / ≥ 8.0 spacing / ≥ 8.3 cards / ≥ 8.0 dashboards / ≥ 7.8 landing / ≥ 8.5 premium feel**.

---

## Certification Methodology

1. Map typography roles, surface tokens, button primitives, card components.  
2. Quantify adoption vs legacy (`design-system:check`, ripgrep).  
3. Sample dense modules (POS, Inventory, Command Center, Hospitality, Home, Marketing).  
4. Separate **theme contrast** (already Phase 29.0/29.1 theme docs) from **visual language** (this doc).  
5. Extract **adoptable principles** from premium enterprise UX practice — never copy layouts.  

**Not performed:** Live eye-tracking; timed preference tests; video frame analysis (videos unavailable).

---

## REFERENCE ANALYSIS — Why premium UIs feel expensive (principles only)

Premium enterprise products (and typical product-tour demos of them) feel polished because of **restraint and system**, not decoration:

| Principle | What it produces | Safe for WAKA? |
|-----------|------------------|----------------|
| **Few type roles, used everywhere** | Instant hierarchy; less “shouting” | Yes — already designed |
| **4/8/12/16/24/32 spacing rhythm** | Calm scanning; predictable denseness | Yes — needs scale + enforcement |
| **2–3 surface elevations only** | Cards/dialogs read without noise | Yes — tokens exist; dark steps improved in theme 29.1 |
| **One primary CTA language** | Trust; fewer competing oranges | Yes — `WakaButton` / `primary` |
| **Quiet neutrals + one brand accent** | Brand without carnival | Yes — keep WAKA orange; reduce multi-hue spectacle in ops |
| **Section breathing room** | Dashboards feel “executive” | Yes — CC already closer than home |
| **Consistent radius family** | Feels intentional | Yes — tighten magic radii |
| **Motion as feedback, not show** | Premium, not playful chaos | Yes — `enterpriseMotion` exists |

**Do not adopt from references:** their fonts as brand replacement, their nav IA, their illustration style, their marketing copy layout, purple/indigo default themes, or card grids that erase WAKA’s POS density needs.

**WAKA identity to preserve:** warm cream ops surfaces, orange brand CTAs, offline-first Uganda POS density, DM Sans / Roboto admin pairing, cart-W mark.

---

## PART 1 — Typography Certification

### Designed roles (`src/lib/enterpriseTypography.ts`)

| Role | Intent | Production adoption |
|------|--------|---------------------|
| Display | Marketing/ops hero | Effectively unused (`<Display>` test-only) |
| Page title | Screen H1 | Via `EnterprisePageHeader` (~16 JSX); `<PageTitle>` **0** prod |
| Section title | Card/section H2 | Moderate (`SectionTitle` ~18) |
| Body | Prose | Moderate (`Body` ~26) |
| Caption | Meta labels | Strongest (`Caption` ~50) but ~half force `normal-case` |
| Mono number | Money / KPIs | Moderate (`MonoNumber` ~29) |

### Evidence of inconsistency

| Signal | Count |
|--------|------:|
| `font-black` | ~2258 |
| Fractional `text-[Npx]` | ~618 matches / **549** scanner violations |
| `text-xl font-black` legacy titles | **107** scanner violations |
| `enterpriseTypeClass(` calls | **36** |
| Dual caption: `enterpriseType.caption` (uppercase) vs `themeUi.caption` (not) | Conflict |

### Findings

1. Hierarchy **flattens** when every label is `font-black`.  
2. POS density fractionals are allowlisted in spirit but leak outside shelf cards (`text-[10px]`/`[11px]` everywhere).  
3. Marketing hero uses a **third** scale (`text-4xl`…`lg:text-[3.35rem]`) disconnected from enterprise roles.  

**Typography score: 5.9 / 10**

---

## PART 2 — Spacing System

### Documented scale

**None** in Tailwind config or a single source of truth. Phase 22.1 already noted default 4px grid only.

### Empirical rhythm (dominant)

```
gap-2 · px-3 · py-2 · p-4 · space-y-4
```

| Pattern | Approx hits | Note |
|---------|------------:|------|
| `gap-2` | ~817 | Default chip/row gap |
| `px-3` | ~859 | Dense chrome |
| `p-4` | ~364 | Card padding candidate |
| `EnterpriseCard` `p-4 sm:p-5` | ~2 literal matches | Scale not spreading |
| Leftover `space-y-5 pb-8` wrappers | 5 sites | Scanner `custom-page-wrapper` |

### Crowded vs oversized

| Surface | Verdict |
|---------|---------|
| POS checkout / cart | Crowded on purpose (`gap-1`, `py-2`) — OK if intentional density token |
| Inventory workspace | Compact `p-3` stacks |
| Command Center | Balanced `space-y-4 sm:space-y-5` |
| Hospitality dashboard | Airier `p-5`/`p-6` / `rounded-3xl` — different product feel |
| Marketing hero | Large vertical gaps — marketing OK if brand-consistent |

**Spacing score: 5.5 / 10**

---

## PART 3 — Surface Hierarchy

| Layer | Token / pattern | Status |
|-------|-----------------|--------|
| Page | `bg-background` | Good (theme 29.1) |
| Card | `themeUi.surface` / `EnterpriseCard` | Underused |
| Elevated | `surface-elevated` | Sparse |
| Dialog | `themeUi.dialog` | OK when used |
| Ad-hoc | `rounded-2xl border` ×**778** | Primary reality |

### Elevation / radius / shadow drift

- `--radius: 0.875rem` with Tailwind sm→3xl mapping — good.  
- Magic radii remain: `rounded-[28px]`, `rounded-[2rem]`, etc.  
- Shadows: `shadow-sm` (~406) dominates; `shadow-waka-sm` (~98); arbitrary home `shadow-[0_16px_48px_…]`; dead tokens `shadow-waka-md` referenced without Tailwind definition.  
- Light mode cards often **border-only** (no `shadow-waka-sm`) → flatter than dark (where fill ΔL improved in theme 29.1).

**Why some screens feel flatter:** not missing “more shadows,” but **inconsistent use of the same 2–3 surface recipes**.

---

## PART 4 — Light Theme Certification (visual hierarchy)

Theme **contrast AA** for muted/status was addressed in Theme Phase 29.1. This part is about **hierarchy perception**.

| Area | Light Mode finding |
|------|--------------------|
| Ops cards | Soft borders on cream — can wash without shadow or stronger border token |
| CTAs | Orange primary strong when `WakaButton`/`bg-primary`; diluted when marketing `bg-waka-` truncates |
| Chips / badges | Semantic after 29.1; still many weight/size variants |
| Hero / home | Gradients + white translucency — hierarchy via spectacle, not system |
| vs Dark | Dark now has clearer fill steps; Light still relies on soft edges → “loses punch” next to dark |

**Light theme VL score: 6.6 / 10** (contrast improved; composition hierarchy still uneven)

---

## PART 5 — Button System

| Variant | Primitive | Reality |
|---------|-----------|---------|
| Primary | `WakaButton` → `bg-primary` | Minority; **226** inline `bg-waka-600` |
| Secondary / ghost / danger | Defined on `WakaButton` | Partial |
| FAB / icon | Mixed | POS FABs custom |
| Heights | 44 / 48 / 52 (+ rare 46) | Three ladders |

`themeUi.btnPrimary` ≈ **0** refs — token bundle unused.

**Button consistency score: 5.7 / 10** (folded into component consistency below)

---

## PART 6 — Dashboard Rhythm

| Dashboard | Rhythm | Premium calm? |
|-----------|--------|---------------|
| Command Center / Owner | Slot stack, KPI grid `gap-2`, `EnterpriseCard` | Closest to enterprise |
| Reports | Enterprise shell + analytics KPIs | Strong |
| Inventory workspace | Compact local `StatCard` ≠ `EnterpriseKpiCard` | Functional, not unified |
| POS | Density-first | Correct for cashiers; not “dashboard calm” |
| Staff / Devices | Mixed enterprise primitives | Improving |
| Hospitality | Large `rounded-3xl`, color-tinted articles | Spectacle drift |
| Pharmacy ops | Slightly airier grids | Mid |
| Home launcher | Gradients, Lottie, arbitrary shadows | Marketing inside product |

**Dashboard score: 6.2 / 10**

---

## PART 7 — Card System

| Primitive | Adoption |
|-----------|----------|
| `EnterpriseCard` | Scanner ~88 refs / ~15 JSX hotspots |
| `EnterpriseKpiCard` | ~47 JSX |
| `WakaCard` | **0** JSX — dead |
| Ad-hoc `rounded-2xl border … bg-card` | Dominant |

Duplicate KPI shells: inventory `StatCard` (`p-3`, `min-h-[88px]`) vs `EnterpriseKpiCard` (`p-2.5`, `min-h-[76px]`).

**Card system score: 5.4 / 10**

---

## PART 8 — Landing Page

Key files: `marketingThemeClasses.ts`, `MarketingHeroSection.tsx`, `MarketingSections.tsx`, public pages under `src/pages/public/`.

### Why Light Mode loses hierarchy

1. **Truncated brand classes** — `bg-waka-`, `text-waka-`, `hover:bg-waka-`, `border-waka-` lack shade suffixes → Tailwind cannot resolve `waka-600` etc. Primary CTAs and accents **fail to paint brand orange reliably**.  
2. **Parallel `--mkt-*` RGB system** — cool gray marketing surfaces diverge from warm ops cream.  
3. **Hero overload** — eyebrow + huge title + long subcopy + 3 chips + dual CTAs + device collage in first viewport (competes with “one composition” discipline).  
4. **Mock chrome** hardcodes `stone` / `rose` / `amber` / `emerald` window dots — fine for illustration, reinforces multi-hue noise.

**Landing score: 5.0 / 10**

---

## PART 9 — Premium Feel Analysis

### Why references feel premium (without copying)

- Silence between sections  
- One accent color used sparingly  
- Type that whispers (medium body) and shouts only at true titles  
- Cards that share padding like a grid system  
- Dashboards that group by job, not by “more widgets”

### How WAKA can feel the same while staying WAKA

| Keep | Change |
|------|--------|
| Orange brand + cream ops | Stop multi-gradient ops home competing with CC |
| Dense POS tiles | Confine fractional type to POS density tokens |
| Offline-first trust cues | Express via semantic status tokens, not rainbow chips |
| DM Sans | Enforce 6 roles; reduce blanket `font-black` |

**Premium feel score: 6.0 / 10**

---

## PART 10 — Component Consistency

| Component | Consistency |
|-----------|-------------|
| Inputs | Mixed enterprise fields vs ad-hoc `rounded-xl border` |
| Chips | Many recipes; statusTokens help after theme 29.1 |
| Tables | `EnterpriseResponsiveTable` only **9** refs — rare |
| KPI cards | Dual implementations |
| Dialogs / drawers | Enterprise modals ~218 refs — better than cards |
| Navigation / headers | `EnterprisePageHeader` vs legacy `PageHeader` (60) vs raw titles |
| Buttons | See Part 5 |

**Component consistency score: 5.8 / 10**

---

## PART 11 — Accessibility (visual language aspects)

| Check | Status |
|-------|--------|
| Color contrast (muted/status) | Improved in Theme 29.1 — defer to that doc |
| Typography legibility | Fractional POS type still risks cashier ID (Phase 28) |
| Touch targets | Many `min-h-[44px]`; not universal |
| Focus rings | Global `:focus-visible` — good |
| Light vs Dark VL | Dark elevation clearer post-29.1; Light hierarchy softer |

**Accessibility (VL) score: 7.0 / 10**

---

## PART 12 — Root Cause Register

| ID | Root cause | Severity | Evidence |
|----|------------|----------|----------|
| **RC-1** | Typography roles not enforced; `font-black` + fractionals dominate | **P0** | 2258 `font-black`; 549 fractional violations; PageTitle unused |
| **RC-2** | No spacing scale / density tokens for ops vs marketing | **P0** | No Tailwind spacing theme; POS `gap-1` vs hospitality `p-6` |
| **RC-3** | Card primitive under-adopted; 778 duplicate recipes | **P0** | `rounded-2xl border` ×778; WakaCard dead |
| **RC-4** | Light VL hierarchy soft + marketing truncated `waka-` classes | **P0** | `marketingThemeClasses.ts` `bg-waka-` / `text-waka-` |
| **RC-5** | Button system dual path (`WakaButton` vs `bg-waka-600`) | **P1** | ~67 vs 226 |
| **RC-6** | Dashboard rhythm split (CC calm vs home/hospitality spectacle) | **P1** | Home gradients; hospitality `rounded-3xl` color articles |
| **RC-7** | Dual caption/heading tokens (`themeUi` vs `enterpriseType`) | **P1** | Conflicting caption uppercase |
| **RC-8** | Shadow/radius magic values + dead `shadow-waka-md` | **P2** | Arbitrary shadows; invalid tokens |
| **RC-9** | Design-system scanner rules miss many inline CTAs | **P2** | `inline-waka-cta` = 0 despite 226 `bg-waka-600` |
| **RC-10** | Landing first viewport over-composed | **P2** | Hero chips + dual CTA + device collage |

---

## PART 13 — Enterprise Roadmap

### P0 — Design consistency foundations (Phase 29.1 VL)

1. **Typography adoption pass** — route high-traffic titles through `EnterprisePageHeader` / roles; ban new `text-xl font-black`; confine fractionals to POS density allowlist.  
2. **Spacing scale token doc + CSS vars** — e.g. `--space-1…6` mapped to 4/8/12/16/24/32; `EnterpriseCard` padding becomes the card standard.  
3. **Card consolidation** — migrate high-traffic `rounded-2xl border bg-card` → `EnterpriseCard` / `themeUi.surface`; delete or wire `WakaCard`.  
4. **Fix marketing `waka-*` shade classes** — restore `waka-600` / `waka-500` etc. so Light landing CTAs regain brand hierarchy (**no redesign**).  

### P1 — Rhythm & chrome

5. Migrate high-traffic CTAs to `WakaButton` (one height story: 44 standard / 52 POS).  
6. Unify KPI cards on `EnterpriseKpiCard` (retire inventory `StatCard` duplicate).  
7. Split **ops home** calm variant vs marketing spectacle (preserve brand, reduce gradient competition inside authenticated shell).  
8. Align hospitality dashboard surfaces to enterprise card language (keep domain color only in status tokens).  

### P2 — Polish

9. Micro-interactions via existing `enterpriseMotion` only.  
10. Landing hero composition trim (brand-first, fewer first-viewport competitors).  
11. Tighten scanner rules for inline CTAs; kill dead shadow tokens.  

### Explicitly out of scope for 29.1

- New brand colors, fonts, or alternative themes  
- Copying any reference layout  
- Rewriting POS density model  
- Re-opening Theme 29.1 contrast work unless regressions appear  

---

## Before / after design principles (adoption targets)

| Principle | Before (today) | After (Phase 29.1 VL target) |
|-----------|----------------|------------------------------|
| Type | Roles optional | Roles mandatory on hubs + settings + CC |
| Spacing | Implicit Tailwind | Named scale + card/section recipes |
| Cards | 778 duplicates | ≤3 recipes (`surface`, `elevated`, `muted`) |
| Buttons | Dual systems | `WakaButton` default for new + high-traffic |
| Ops vs marketing | Blurred | Clear boundary; shared brand orange |
| Light hierarchy | Soft + broken mkt shades | Fixed shades + consistent card edge |
| Premium feel | Uneven | Calm ops + confident brand accent |

---

## Deliverable score summary

| Dimension | Score |
|-----------|------:|
| Mobile | **6.4 / 10** |
| Tablet | **6.8 / 10** |
| Desktop | **7.1 / 10** |
| Typography | **5.9 / 10** |
| Spacing | **5.5 / 10** |
| Card system | **5.4 / 10** |
| Light theme (VL) | **6.6 / 10** |
| Dashboard | **6.2 / 10** |
| Landing page | **5.0 / 10** |
| Accessibility (VL) | **7.0 / 10** |
| Premium feel | **6.0 / 10** |
| **Overall** | **6.1 / 10** |

---

## Success Criteria — Answers

| Question | Answer |
|----------|--------|
| Why do premium references feel premium? | Restraint: few type roles, spacing rhythm, 2–3 surfaces, one accent, quiet dashboards. |
| Which principles can WAKA adopt without copying? | Role typography, spacing scale, card/button primitives, ops/marketing boundary, shade-correct brand CTAs. |
| Which inconsistencies remain? | Type adoption, spacing freestyle, card/button duplication, dashboard personality split, landing truncated classes. |
| Why does Light lose hierarchy vs Dark? | Soft cream borders + marketing broken `waka-` shades; Dark gained clearer fill steps in Theme 29.1. |
| How to unify into one language? | Phase 29.1 on **tokens + primitives**, not page-by-page restyles. |
| Smallest roadmap? | P0: type enforcement + spacing scale + card consolidation + marketing shade fix. |

---

## Appendix A — Key files

| File | Role |
|------|------|
| `src/lib/enterpriseTypography.ts` | 6 type roles |
| `src/components/enterprise/EnterpriseTypography.tsx` | React wrappers |
| `src/lib/themeTokens.ts` | `themeUi` surfaces/buttons |
| `src/components/enterprise/EnterpriseCard.tsx` | Canonical card |
| `src/components/ui/wakaPrimitives.tsx` | `WakaButton` / `WakaCard` |
| `src/components/marketing/marketingThemeClasses.ts` | Landing tokens (**truncated `waka-`**) |
| `src/components/marketing/website2026/MarketingHeroSection.tsx` | Hero composition |
| `scripts/design-system-enforcement.mjs` | Adoption ledger (44% high-traffic) |
| Theme Phase 29.0/29.1 doc | Color/contrast (adjacent, not duplicated) |

## Appendix B — Scanner snapshot

### Pre-29.1 (audit baseline)

| Metric | Value |
|--------|------:|
| High-traffic primitive adoption | 29/66 (**44%**) |
| Business workspace adoption | 14/33 (**42%**) |
| Informational violations | **672** |
| Fractional typography | **549** |
| Legacy page titles | **107** |
| Inline `bg-waka-600` | **226** |
| `WakaButton` refs | **201** |
| `EnterpriseCard` refs | **88** |
| `EnterpriseResponsiveTable` | **9** |

### Post-29.1 foundation (2026-08-03)

| Metric | Value |
|--------|------:|
| High-traffic primitive adoption | 30/66 (**45%**) |
| Business workspace adoption | 14/33 (**42%**) |
| `EnterpriseCard` refs | **96** |
| `EnterpriseKpiCard` refs | **95** |
| `enterpriseSpace` refs | **22** |
| `shadow-elev` refs | **20** |
| Informational violations | **943** (rules expanded: spectacle, muted0, ad-hoc cards, truncated shades) |
| Legacy `font-black` count | **2226** (tracked; titles/KPI roles now `font-bold`) |
| Module spectacle fills | **195** (tracked for personality unification) |

---

**Certified by:** Phase 29.0 Visual Language read-only forensic audit — 2026-08-03  
**Decision:** Design **system architecture approved**; unified **premium visual language not certified**.  
**Recommended next step:** Phase 29.1 implementation focused exclusively on **design tokens + primitives adoption** (typography, spacing, cards, buttons, marketing shade repair) so one change improves hundreds of screens — **without copying any reference product**.

---

# Phase 29.1 — Enterprise Design Token Enforcement & Premium Visual Consolidation

**Date:** 2026-08-03  
**Goal:** Every screen should look like it was designed by the same design team on the same day.  
**Strategy:** Token + primitive enforcement first; high-traffic personality unification; not a new design system.

## What shipped

### P0 — Token enforcement

| Item | Change |
|------|--------|
| Spacing scale | `--space-1…4` (8/16/24/32) + `enterpriseSpace` recipes (`src/lib/enterpriseSpacing.ts`) |
| Elevation | `--elev-shadow-sm/md` + Tailwind `shadow-elev` / `shadow-elev-md`; `themeUi.surface*` uses border + elev |
| Typography | `enterpriseType` titles/numbers → `font-bold` (drop `font-black` misuse) |
| Cards | `EnterpriseCard` / `EnterpriseKpiCard` tightened to spacing + elev; `WakaCard` alias aligned |
| Buttons | `WakaButton` / `themeUi.btnPrimary` → `bg-primary` + `font-bold` + elev shadow |
| Marketing Light | Restored full `waka-*` shade classes in `marketingThemeClasses.ts` |
| Palette typos | Cleared `*-muted0` corruptions from prior replace |

### P0/P1 — Personality unification (ops calm = one app)

| Module surface | Change |
|----------------|--------|
| Hospitality dashboard | Emerald/violet/amber spectacle KPIs → `EnterpriseKpiCard` tones; CTAs → `themeUi` buttons; cards → `EnterpriseCard` |
| Inventory workspace KPIs | Local `StatCard` removed → `EnterpriseKpiCard` |
| Home business hero | Gradient spectacle + heavy drop-shadow → card/muted enterprise shell + primary CTA |
| Home trust banner | Hard-coded emerald → `statusTokens` banners |
| Command Center shell | Unified `space-y-4 sm:space-y-6` across pharmacy + default surfaces |
| Page container | Default/workspace variants use `enterpriseSpace` stacks |

### Enforcement

`scripts/design-system-enforcement.mjs` now tracks:
- truncated `waka-*` shades, `*-muted0` typos, module spectacle palettes, ad-hoc card shells
- adoption of `enterpriseSpace` + `shadow-elev`
- legacy `font-black` + emerald/violet fills

## Target scorecard (post-29.1 direction)

| Area | Before (29.0 audit) | After target |
|------|--------------------:|-------------:|
| Typography | 5.9 | **~9.4** |
| Spacing | 5.5 | **~9.3** |
| Cards | 5.4 | **~9.5** |
| Landing | 5.0 | **~9.2** |
| Dashboards | 6.2 | **~9.1** |
| Premium feel | 6.0 | **~9.6** |
| **Overall VL** | **6.1** | **~9.4–9.6** |

Remaining adoption debt (informational scanner) is expected — Phase 29.1 establishes the **language**; residual screens inherit via primitives over time (maintenance mode), not another overhaul.

## Explicit requirement met

**Enterprise Personality Unification:** Home / Hospitality no longer present a separate “spectacle app” identity vs Inventory / CC / ops. Module-specific meaning still uses `statusTokens` tones where status matters; decorative multi-hue KPI identities removed on the hospitality path.

## Key files

| File | Role |
|------|------|
| `src/lib/enterpriseSpacing.ts` | Spacing scale + recipes |
| `src/lib/themeTokens.ts` | Surfaces, buttons, spacing recipes |
| `src/index.css` / `tailwind.config.ts` | CSS vars + `shadow-elev` / `space-*` |
| `src/components/marketing/marketingThemeClasses.ts` | Fixed Light landing shades |
| `src/pages/HospitalityDashboardPage.tsx` | Personality unification exemplar |
| `src/components/home/HomeBusinessHero.tsx` | Home aligned to enterprise calm |
| `scripts/design-system-enforcement.mjs` | Ongoing ledger |

**Decision:** Phase 29.1 **token enforcement + personality unification foundation shipped**. Full scorecard certification deferred to a short adoption pass once high-traffic residual `font-black` / ad-hoc cards fall below maintenance thresholds.
