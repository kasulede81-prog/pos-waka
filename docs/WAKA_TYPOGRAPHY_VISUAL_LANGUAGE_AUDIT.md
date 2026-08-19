# WAKA POS — Typography & Visual Language Forensic Audit

**Date:** 2026-08-19  
**Mode:** FORENSIC AUDIT ONLY — no source, CSS, Tailwind, font, component, POS, checkout, sync, auth, or database changes.  
**Output:** this document only.

**Physical-device measurement was not performed.** Contrast and fold comments are code-derived. Rows marked **device** need Safari / Capacitor / Electron confirmation.

---

## PRIMARY ANSWER

WAKA already has a **real design system** (semantic CSS variables, `themeUi`, `enterpriseType`, Enterprise components, warm cream + orange brand). The polished feeling in a typical modern operational UI is **not** primarily a secret font name. It is:

1. **Weight discipline** — real loaded weights, not synthesized 500/600/900.
2. **Hierarchy contrast** — headings vs supporting text vs numbers, with tracking used sparingly.
3. **Surface quietness** — page wash vs card vs muted, thin borders, light elevation.
4. **Numeric tabular alignment** — money columns and KPIs that do not dance.
5. **Icon containment** — small rounded wells, not oversized marketing art.

WAKA currently uses **DM Sans** for the product UI (400 + 700 loaded) and **Roboto** for internal admin. The declared stack lists **Inter**, but Inter is **not loaded**. Operational screens widely use `font-black` (900), `font-semibold` (600), and `font-medium` (500) even though those DM Sans files are not imported — browsers synthesize or snap those weights. Phase 29.1 already told titles to prefer `font-bold`; Home tiles, Sell, checkout, and Settings still shout `font-black`.

**EXACT FONT (reference): UNVERIFIED.** No screenshot, Figma, or font file was attached to this audit request. Do not name or copy another product’s typeface.

**Safe path:** keep DM Sans (WAKA identity + already packaged for offline/Electron/Capacitor), **complete the weight files**, **enforce the existing six-role type system**, and refine tokens/components later. Do **not** globally restyle Sell, checkout, Home tile min-heights, or Home region order.

---

# PART 1 — CODEBASE DISCOVERY

Evidence is from production `src/` plus `tailwind.config.ts`, `index.html`, and `package.json`. `lovable-import/` is leftover import UI (includes a Google Fonts Inter link). It is **not** the live app shell.

Risk if changed globally: **LOW** = visual/token only, easy revert. **MED** = shared components / many screens. **HIGH** = POS density, Home fold, checkout, auth.

| # | File path | Purpose | Shared / page | Typography | Visual styling | Global change risk |
|---|---|---|---|---|---|---|
| 1 | `src/index.css` | Global CSS: Tailwind layers, `:root` / `.dark` HSL tokens, body font, focus, tables, POS Display Scale, marketing `mkt-*` tokens, iOS 16px input floor | Shared | Body stack; Display Scale font vars (Sell only) | Surfaces, elevation, status, radius, motion | **HIGH** |
| 2 | `src/main.tsx` | App boot; **only** font CSS imports | Shared | Loads DM Sans 400/700, Roboto 400/500/700/900 | None | **MED** (font files) |
| 3 | `index.html` | Document shell; **no** Google Fonts link | Shared | None | `theme-color` cream `#fffaf5` | LOW |
| 4 | `tailwind.config.ts` | Tailwind: `font-sans` / `font-admin`, semantic colors, radius, shadows, spacing aliases | Shared | Font family maps | Color/radius/shadow | **HIGH** |
| 5 | `src/lib/brandTokens.ts` | Brand hex + font stack + radius/shadow constants | Shared | `WAKA_BRAND_FONT_STACK` | Orange/cream constants | MED |
| 6 | `src/lib/themeTokens.ts` | `themeUi` class bundles (surfaces, buttons, input, table head, focus) | Shared | `heading` / `subheading` / `caption` (legacy) | Canonical card/dialog/button/input | **HIGH** |
| 7 | `src/lib/enterpriseTypography.ts` | Six semantic type roles + POS-only fractional sizes | Shared | **Canonical type contract** | None | **HIGH** if sizes change |
| 8 | `src/components/enterprise/EnterpriseTypography.tsx` | `Display`, `PageTitle`, `SectionTitle`, `Body`, `Caption`, `MonoNumber` | Shared | Renders roles | None | MED |
| 9 | `src/lib/enterpriseSpacing.ts` | 8px rhythm: pageStack, cardPad, kpiGrid | Shared | None | Spacing | MED |
| 10 | `src/lib/enterpriseMotion.ts` | Shared easing, press, hoverLift, focus | Shared | None | Interaction | MED |
| 11 | `src/lib/enterpriseIcons.ts` | Lucide size map, stroke 2 | Shared | None | Icon geometry | LOW |
| 12 | `src/lib/statusTokens.ts` | Status badges/dots/banners (not color-only) | Shared | `text-xs font-bold` badges | Status color + muted fills | MED |
| 13 | `src/components/ui/wakaPrimitives.tsx` | Production `WakaButton` | Shared | `text-sm font-bold`; POS size `text-base` | Variants, `min-h-[44px]` / `52px`, `rounded-xl` | **HIGH** (touch) |
| 14 | `src/components/ui/PinInput.tsx`, `MoneyInput.tsx`, `AppThemeToggle.tsx` | Live UI primitives | Shared | Numeric/PIN entry | Controls | HIGH for Money/PIN |
| 15 | `src/components/enterprise/EnterpriseCard.tsx` | Canonical card | Shared | Title via `enterpriseTypeClass` | `themeUi.surface` + `cardPad` | MED |
| 16 | `src/components/enterprise/EnterpriseKpiCard.tsx` | KPI card | Shared | Caption + MonoNumber | Icon well, tone shells | MED |
| 17 | `src/components/enterprise/EnterpriseTextField.tsx` | Form field | Shared | Label `body` overridden to `text-sm font-bold`; POS input `text-2xl font-black tabular-nums` | `wakaUi.input` / POS 52px | HIGH if POS |
| 18 | `src/components/enterprise/WakaSwitch.tsx`, `WakaCheckbox.tsx` | Toggles | Shared | Labels via callers | Track/thumb tokens | MED |
| 19 | `src/components/enterprise/data-table/EnterpriseDataTable.tsx` | Desktop virtualized table | Shared (desktop workspaces) | Headers `text-[10px] font-bold uppercase tracking-wide` | 44px row estimate | **HIGH** (readability/density) |
| 20 | `src/components/shared/ResponsiveDataTable.tsx` | `.waka-data-table` wrapper | Shared | Relies on `index.css` table utilities | Ring + sticky head | MED |
| 21 | `src/components/layout/ModalSheet.tsx` | Bottom sheet / centered dialog | Shared | `enterpriseDialogTitle` | `themeUi.dialog`, overlay | MED |
| 22 | `src/components/layout/ConfirmationDialog.tsx` | Confirm modal | Shared | Dialog title role | Dialog tokens | MED |
| 23 | `src/components/layout/AppShell.tsx` | Logged-in chrome, header, lock, Display Scale (Sell only) | Shared | Header labels; `font-black` in places | Shell layout, safe areas | **HIGH** |
| 24 | `src/components/layout/EnterprisePageContainer.tsx` | Page root + safe-area padding | Shared | None | `enterprise-page` spacing | MED |
| 25 | `src/components/layout/HeaderBackButton.tsx`, `DesktopTerminalBackBar.tsx`, `MobileModuleExitBar.tsx` | Nav chrome | Shared | Button labels | 44px targets | HIGH if heights change |
| 26 | `src/pages/DesktopHomePage.tsx` | Home greeting + measure/gutters | Home | Greeting `text-lg sm:text-xl font-black`; sub `text-sm font-medium` | HOME-DENSITY-1.1 measure | **HIGH** (fold) |
| 27 | `src/components/home/DesktopHomeTiles.tsx` | Live Home regions | Home | Section titles `!text-sm sm:!text-base` | Grid + region composition | **HIGH** |
| 28 | `src/components/home/HomeOrderedRegions.tsx` | DOM = visual/keyboard order | Home | None | Order only | **HIGH** (IA) |
| 29 | `src/lib/homePresentation.ts` | Region order, grids, gutters, `max-w-7xl` | Home shared | None | Density / first-screen | **HIGH** |
| 30 | `src/hooks/useHomeRegionLayout.ts` | `lg` 1024 / `xl` 1280 layout flags | Home | None | Packing | **HIGH** |
| 31 | `src/components/home/LivingDashboardCard.tsx` | Module tiles | Home | Title `text-sm sm:text-base font-black`; subtitle `text-[11px]`; liveStat `text-[10px]` + `text-sm tabular-nums` | `min-h-[112px]` / `96px`, accent rail | **HIGH** |
| 32 | `src/components/home/HomeTileAccentWell.tsx` | Icon well 36×36 / 48×48 | Home | None | Accent fill | MED |
| 33 | `src/components/home/HomeBusinessHero.tsx` | Sell hero | Home | Shop `text-lg sm:text-xl font-bold`; CTA `text-sm sm:text-base font-bold` `min-h-[48px]` | Locked Sell CTA | **HIGH** |
| 34 | `src/components/home/HomeReportsPreview.tsx` | Dedicated Reports card | Home | LiveStat + `text-xs font-black` | `min-h-[88px]` | **HIGH** |
| 35 | `src/components/home/HomeExecutiveKpiStrip.tsx`, `HomeBusinessHealthSection.tsx` | KPI / health | Home | SectionTitle + chips `text-[11px] font-bold` `min-h-[44px]` | Executive scan | **HIGH** (fold) |
| 36 | `src/components/home/HomeMenuArrangePanel.tsx` | Settings Home preview | Settings / Home | Mirrors live type | Must stay honest | **HIGH** |
| 37 | `src/pages/PosPage.tsx` | Sell / checkout host | POS | Orchestrates catalog + cart | Layout modes | **HIGH** — do not restyle globally |
| 38 | `src/components/pos/PosSellProductCard.tsx`, `PosDesktopProductCard.tsx` | Product selection | POS | `pos-ds-product-name` `text-[13px] font-black`; price `text-xs font-black tabular-nums` | Display Scale hooks | **HIGH** |
| 39 | `src/components/pos/PosCheckoutPanel.tsx` | Payment / keypad | POS | Heavy `font-black`; keypad `text-2xl font-semibold`; totals `text-3xl` | Touch geometry | **HIGH** |
| 40 | `src/components/pos/DraftCartLineRow.tsx`, `DraftCartTotalsStack.tsx` | Cart lines + payable | POS | Lines `font-black tabular-nums`; payable `text-2xl font-black tabular-nums` | Totals hierarchy | **HIGH** |
| 41 | `src/components/pos/desktop/*` | Electron desktop POS shell | POS / desktop | Header/status/grid/cart | Terminal layout | **HIGH** |
| 42 | `src/lib/desktopPosKeyHandlers.ts` | Keyboard shortcuts | POS | None | None | **DO NOT TOUCH** |
| 43 | `src/pages/StockPage.tsx` + `src/features/inventory/**` | Inventory | Inventory | Mix of enterprise + `font-black` | Workspace tables/cards | MED |
| 44 | `src/pages/ReportsPage.tsx`, `ProfitPage.tsx`, pharmacy/hospitality report pages | Reports | Reports | KPI grids, charts | Cards | MED |
| 45 | `src/pages/ReceiptsPage.tsx`, `src/components/receipts/*` | Sales history | Sales history | Row amounts `font-black tabular-nums` | Table + mobile cards | MED |
| 46 | `src/pages/CashManagementPage.tsx`, `CashPositionPage.tsx`, `src/components/cash-position/*` | Cash drawer / position | Cash | Heavy `font-black` in cash-position sections | Dense financial UI | MED–HIGH (numeric) |
| 47 | `src/pages/SettingsHubPage.tsx` + `Settings*Page.tsx` | Settings | Settings | `SettingsPageHeader` → `EnterprisePageHeader` compact; many pages still `font-black` | Cards, 44px+ targets | MED |
| 48 | `src/components/internal-admin/v2/AdminShell.tsx` | Internal oversight | Admin | `font-admin` (Roboto first) | Admin page tokens | MED (admin-only) |
| 49 | `src/lib/receiptPrint.ts`, `src/lib/shiftReportExport.ts` | Print HTML | Print | Receipt uses **Inter** in CSS string (not app UI); shift export `system-ui` | Print-only | LOW for app UI; do not mix into VL-1 |
| 50 | `src/components/AppRootErrorBoundary.tsx` | Crash UI | Shared | Inline `system-ui` | Isolated | LOW |
| 51 | `electron/main.cjs`, `electron/shell/recovery.html` | Electron shell | Desktop | Recovery page independent | Shell | Do not change for VL-1 |
| 52 | `resources/brand/README.md` | Brand asset contract | Brand | None | Cream `#fffaf5`, W mark | KEEP |

**Architecture that is present:** a **declared** enterprise layer (`enterpriseType` + `themeUi` + Enterprise\* components) **and** a **larger ad-hoc layer** (`font-black` / one-off `text-[Npx]` across hundreds of files). Dual systems are a fact, not a proposal.

**Not present:** a second mobile Home; a global display-scale for Home; a live shadcn `src/components/ui/button.tsx` as the production button (`lovable-import` only).

---

# PART 2 — CURRENT FONT FORENSICS

## CURRENT FONT INVENTORY

| Location | Font family | Weight(s) | Source | Verified? | Notes |
|---|---|---|---|---|---|
| `src/main.tsx` | DM Sans | 400, 700 | `@fontsource/dm-sans/400.css`, `700.css` (`package.json` `^5.2.8`) | **Yes** | Only product UI files loaded |
| `src/main.tsx` | Roboto | 400, 500, 700, 900 | `@fontsource/roboto/*` (`^5.2.10`) | **Yes** | Intended for `font-admin` |
| `src/index.css` `body` | `"DM Sans", Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | inherits | CSS stack | **Yes** | `font-optical-sizing: auto`; Inter **not imported** |
| `src/lib/brandTokens.ts` | Same stack as body | — | Constant | **Yes** | Matches body |
| `tailwind.config.ts` `fontFamily.sans` | DM Sans, Inter, system-ui, Segoe UI, Roboto | — | Tailwind | **Yes** | Default `font-sans` |
| `tailwind.config.ts` `fontFamily.admin` | Roboto, DM Sans, Inter, system-ui, Segoe UI | — | Tailwind | **Yes** | `AdminShell`, `themeUi.adminPage` |
| Email HTML (`supabase/functions/_shared/email/layout.ts`) | DM Sans, Inter, Segoe UI, Roboto | 700–800 declared | Remote/client mail | Yes (markup) | Not the POS WebView |
| Receipt print CSS (`src/lib/receiptPrint.ts`) | `"Inter", system-ui, …` for `.waka-receipt`; monospace for body thermal | — | Print stylesheet | **Yes** | **Inconsistent with app UI** |
| Shift report export | `system-ui, sans-serif` | — | Print | **Yes** | Isolated |
| Crash boundary | `system-ui, sans-serif` | — | Inline | **Yes** | Isolated |
| `index.html` | — | — | No `@font-face` / Google Fonts | **Yes** | Fonts boot from `main.tsx` only |
| `lovable-import/.../__root.tsx` | Inter via Google Fonts CSS | 400–900 | Import leftover | N/A | **Not live** |
| Variable font | DM Sans variable **not** imported | — | — | **Yes (absent)** | Static 400/700 only |
| Electron | Same Chromium bundle as Vite build | Same files | Packaged `@fontsource` | **Inferred** | No separate Electron font config found in this audit |
| Android / Capacitor | Same CSS in WebView | Same files | Capacitor loads `www` | **Inferred** | No extra native font XML found for DM Sans |
| iOS | Same + `index.css` 16px input floor | Same | WebView | **Inferred** | Protects Safari auto-zoom |

### Weight availability vs usage (verified drift)

Tailwind maps:

- `font-medium` → 500  
- `font-semibold` → 600  
- `font-bold` → 700 (loaded)  
- `font-black` → 900  

**Loaded for DM Sans:** 400, 700 only.  
**Used widely on product UI:** 500, 600, 900 (`font-black` appears across a large share of `src/` files, including Home, Sell, checkout, cash position, Settings).  
**Effect:** synthetic bold/black or snap-to-700. That is the opposite of “premium”: outlines look uneven, especially on Android WebView and small UGX strings.

Phase 29.1 comment in `enterpriseTypography.ts`: reserve `font-black` for rare display emphasis; titles should be `font-bold`. **Code does not follow that comment outside the six-role helper.**

`enterpriseType.body` uses `font-medium` (500) — **not loaded**. `caption` uses `font-semibold` (600) — **not loaded**.

### Inconsistent families

- Product app: DM Sans (intended).  
- Internal admin: Roboto (`font-admin`) — **intentional split**.  
- Receipt print: Inter named in CSS — **drift**.  
- Fallback Inter: listed everywhere, **never loaded**; next paint is `system-ui` / `-apple-system` / Segoe / Roboto if DM Sans fails.

### Browser / system fallback

If `@fontsource` chunks fail (offline cache miss, Electron asar path bug): OS UI font. On iOS that is SF Pro; on Windows Segoe; on Android Roboto/Noto. **Metrics differ** — wrapping and table columns will shift. Completing local weights reduces (does not eliminate) that risk.

---

## TYPOGRAPHY USAGE MAP (actual, not aspirational)

Sizes are Tailwind defaults unless noted (`text-sm` = 14px / 1.25lh, `text-base` = 16px / 1.5lh, `text-lg` = 18px, `text-xl` = 20px, `text-2xl` = 24px, `text-3xl` = 30px, `text-4xl` = 36px).

| Role | Where verified | Typical size / weight / leading / tracking | Consistent? |
|---|---|---|---|
| Display | `enterpriseType.display` | 24 / 30 / 36px, **bold**, tracking-tight | Helper exists; **rarely used** vs `font-black` page heroes |
| Page headings | `EnterprisePageHeader` / `pageTitle` | 20 / 24px, bold, tracking-tight | Used on some Settings/enterprise pages |
| Home greeting | `DesktopHomePage` | 18 / 20px, **black**, tracking-tight | Drift: black not bold |
| Section headings | Home `SectionTitle` with `!text-sm sm:!text-base` | 14 / 16px, bold | Home **downsizes** the 16/18px section role |
| Card titles | `LivingDashboardCard` | 14 / 16px, **black**, truncate | Drift from `sectionTitle` |
| Body | `enterpriseType.body` | 14 / 16px, **medium**, leading-relaxed | Helper; many pages use `text-sm font-medium` ad hoc |
| Supporting | Home tile subtitle | 11 / 12px, medium, leading-snug, line-clamp-2 | Fractional 11px **prohibited outside POS** by `PROHIBITED_FRACTIONAL_TYPE` — **Home violates the documented rule** |
| Small labels | Reports/KPI liveStat, hero meta | 10px, bold/semibold, uppercase, tracking-wide | Repeated pattern; 10px is POS-density token used on Home |
| Status | `statusTokens` badges | 12px, bold; chips `text-[11px]` on Home health | Mixed |
| Buttons | `WakaButton` / `themeUi.btn*` | 14px bold; POS 16px; CSS `.waka-btn-primary` is **font-black** | **Token vs CSS utility drift** |
| Financial / KPI | `MonoNumber` + many ad hoc | bold/black + `tabular-nums`; KPI often `text-lg`–`text-2xl` | Tabular often present; weight not |
| Table headings | `themeUi.tableHead` vs `EnterpriseDataTable` | 12px bold uppercase **vs** 10px bold uppercase | **Two heading sizes** |
| Table values | `.waka-data-table` td | 14px, default weight unless cell overrides | Mixed `font-black` in money cells |
| Form labels | `EnterpriseTextField` | 14px **bold** (overrides body) | OK |
| Inputs | `themeUi.input` | 16px, default weight, min-h 48; iOS floor 16px | POS field jumps to 24px black |
| POS product names | `PosDesktopProductCard` | 13px black, leading-snug, line-clamp-3; Display Scale overrides | Fractional; POS-allowed |
| POS prices | same | 12px black tabular | Dense — keep |
| Totals | `DraftCartTotalsStack` payable | 24px (compact 18px) black tabular | Operational — keep size, fix weight loading |
| Checkout keypad | `PosCheckoutPanel` | 18–24px semibold/bold; keys min-h 36–56 | **HIGH RISK** |
| Receipt-related UI | Sales history rows | `text-sm font-black tabular-nums` | App UI; print CSS is Inter |

**Where the system is consistent:** semantic color tokens; 44/48/52px control floors in `themeUi`; `tabular-nums` on money in POS/Home live stats; Lucide stroke 2; warm cream page + orange primary.

**Where it has drifted:** (1) `font-black` as default “important” instead of `font-bold`; (2) Home and tables use 10–11px despite the enterprise “no fractional outside POS” rule; (3) `enterpriseType` adopted in shells, not in Sell/Home tiles/cash; (4) Inter in print vs DM Sans in app; (5) button utilities disagree (`font-bold` vs `font-black`).

---

# PART 3 — REFERENCE STYLE ANALYSIS

**EXACT FONT: UNVERIFIED**

No visual reference file, screenshot, or brand name was supplied in this audit session. The following does **not** identify another product’s typeface.

### A. WHAT IS ACTUALLY OBSERVABLE

- From this request: an intent to feel “refined, modern, premium” **without cloning** another app, without redesigning WAKA, without harming POS speed.
- From WAKA code: warm stone background, orange primary, rounded-2xl cards, light elevation, dense operational type, heavy use of extra-bold.

### B. REASONABLE DESIGN INFERENCE

Typical “premium operational” UIs (not attributed to a named font) share:

**Typography**

- Geometric or neo-grotesque sans with **large x-height** (good for UI, risky if too round for UGX).
- Headings **tighter tracking**, body **neutral tracking**.
- **Weight gap** between title (semibold/bold) and meta (regular/medium) — not everything extra-bold.
- Labels: small, uppercase **or** small sentence case with muted color — not both shouting.
- Numbers: tabular figures, slightly tighter tracking, often same family (not a display serif).
- Line-height: headings compact (~1.15–1.25); body ~1.4–1.5; dense tables tighter.

**Surfaces**

- Page slightly cooler or more even than cards; cards near-white; **1px low-contrast borders**; radius in a **narrow band** (12–16px), not mixing pills and sharp boxes.
- Shadows **barely there** (or none, border-only).
- Whitespace used to **group**, not to empty the fold.

**Components**

- Icons in **square wells** with muted fill (WAKA Home already does this via `HomeTileAccentWell`).
- Buttons: one solid primary, quiet secondary, no gradient chrome.
- Live values: muted label + strong number.
- Chevrons as affordances, not decoration.
- Tables: small caps headers, aligned numbers.

### C. UNVERIFIED / CANNOT BE CONFIRMED

- Exact font family, optical size, or variable-font axes of any reference.
- Exact radius/shadow/px from an unseen mock.
- Whether the reference uses SF Pro, Inter, Geist, Plus Jakarta, or something else.
- Color palette of the reference (must not be copied anyway).

---

# PART 4 — WAKA VS REFERENCE COMPARISON

Reference column = inferred “refined operational UI” (Part 3B), **not** a measured screenshot.

| Design dimension | Current WAKA | Reference characteristic | Gap | Adapt safely? | Classification |
|---|---|---|---|---|---|
| Font personality | DM Sans, geometric-humanist; often **synthesized black** | Even loaded weights; calm bold | Weight files + stop fake 900 | Yes — keep family | **TYPOGRAPHY ONLY** |
| Heading hierarchy | Two systems: `enterpriseType` vs `font-black` ad hoc | Clear display / title / section | Adopt existing roles | Yes on non-POS | **TYPOGRAPHY ONLY** |
| Body hierarchy | `font-medium` without 500 file; mixed sizes | Regular/medium loaded | Load 500 or map body to 400 | Yes | **TYPOGRAPHY ONLY** |
| Numeric hierarchy | Tabular often; weight black | Tabular + bold, not black | Align to `monoNumber` | POS later | **COMPONENT REFINEMENT** then POS |
| Font weight discipline | 400/700 files vs 500/600/900 classes | Weights match files | **Largest cheap win** | Yes | **TYPOGRAPHY ONLY** |
| Line-height | Body `leading-relaxed`; POS `leading-snug` | Compact titles, readable body | Do not raise Home/POS lh | Partial | **KEEP** on POS/Home tiles |
| Letter spacing | Titles `tracking-tight`; captions `tracking-wide` | Same pattern | Fine | Yes | **KEEP** |
| Card density | Home `min-h` 112/96/88; `p-3.5` | Airy marketing cards | **Do not add air** | No extra padding | **HIGH-RISK — DO NOT CHANGE GLOBALLY** |
| Card borders | `border-border` 1px | Subtle 1px | Already close | Token contrast only | **TOKEN CHANGE** (test) |
| Card radius | `rounded-2xl` from `--radius` 0.875rem + 8px | Consistent radius | Already a system | Don’t invent per-page | **KEEP** |
| Shadows | `--elev-shadow-sm/md` warm/orange-tinted in brand constants; CSS elev is stone | Very light | Optional quieter elev | After visual test | **TOKEN CHANGE** |
| Page background | HSL `30 15% 96%` warm | Quiet wash | Keep WAKA cream | **KEEP** | **KEEP** |
| Surface hierarchy | background / muted / card / elevated / dialog | Stepped surfaces | Already in `:root` | Use tokens, don’t add new | **KEEP** + adoption |
| Icon containers | Home wells 36px rounded-xl + 4px rail | Contained icons | Refine well radius only if needed | Home-compatible | **COMPONENT REFINEMENT** |
| Buttons | 44px floor, bold, orange primary | Quiet, one primary | Don’t shrink; don’t blacken | Align `.waka-btn-primary` to `font-bold` | **SHARED COMPONENT** |
| Section spacing | `mb-4 sm:mb-5` Home; `pageStack` elsewhere | Consistent rhythm | Don’t increase Home `mb-*` | **KEEP** Home | **KEEP** |
| Table readability | 10px vs 12px headers; 44px rows | Dense but aligned | Unify header role; don’t raise row | Desktop tables | **COMPONENT REFINEMENT** |
| Form density | 48px inputs, 16px text | Tall enough for touch | Keep | **KEEP** | **KEEP** |
| POS transaction density | Fractional type + Display Scale | Fast scan | **Do not loosen** | Visual only later | **HIGH-RISK — DO NOT CHANGE GLOBALLY** |
| Mobile readability | 10–11px labels on Home | Some refs use 12px | Raising to 12px can add tile height / wrap | Mitigate or skip | **HIGH-RISK** on Home |
| Desktop/Electron | `max-w-7xl` Home; POS wide shell | Comfortable measure | Don’t stretch type with window | **KEEP** | **KEEP** |

---

# PART 5 — FONT DECISION AUDIT

### OPTION A — Keep current font, improve hierarchy

**Fits WAKA.** DM Sans is already brand (`brandTokens`, emails). Local `@fontsource` works offline/Electron/Capacitor. Completing 500 (and 600 if captions stay semibold) removes synthesis. Mapping operational “emphasis” from 900 → 700 matches Phase 29.1.

| Criterion | Assessment |
|---|---|
| POS speed | Neutral if sizes unchanged |
| Long product names | Same metrics as today (DM Sans 700 vs fake 900 is slightly narrower — **test wrap**) |
| UGX values | Better if tabular + real 700 |
| Dense tables | Safer than a new family |
| 390px / desktop / Electron / Android / iOS | Same family; load extra woff2 |
| Accessibility | Real weights improve stroke evenness |
| Loading / offline | Two extra static files (or one variable) — see Part 12 |
| Licensing | `@fontsource/dm-sans` already in `package.json` (SIL OFL typical for DM Sans — confirm on implement) |
| Maintainability | Best: one family, documented weights |

### OPTION B — New font globally

**No-go for this product phase.** Re-wraps every tile, table, receipt-adjacent UI, POS card `line-clamp-3`, Display Scale. Identity risk (stops looking like WAKA). Licensing + packaging work with no verified reference font.

### OPTION C — New primary + fallbacks

Same as B unless the new face is **metric-compatible** with DM Sans (unverified). Extra fallback complexity (Inter is already an unloaded fallback).

### OPTION D — Display / UI / numeric families

**Not first.** WAKA money already uses DM Sans + `tabular-nums`. A numeric-only family (e.g. IBM Plex Mono) would clash with UGX “POS speed” and packaging. Optional later for **print thermal** only (already monospace in one print path).

## FONT VERDICT

- **GO for OPTION A (keep DM Sans).**  
- **NO-GO for a new global family** until a reference font is verified **and** a metric test passes at 390 / 1024×768 / Sell.  
- Exact new font: **none**.  
- Fallback stack (keep): `"DM Sans", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`  
- Required weights to **load** (proposed, not implemented): **400, 500, 700**; **600** if `caption` stays semibold; **do not load 900** unless a rare display role truly needs it — prefer `font-bold`.  
- Variable font: **optional later** (one file, wght axis) vs four static files — see Part 12.  
- Tabular figures: **keep and extend** (`tabular-nums lining-nums` on financial roles). DM Sans supports tabular via `tnum` when the file includes it — **verify in VL-1** with a UGX column screenshot.  
- Expected risk: **low** if sizes/line-heights unchanged; **medium** if `font-black` → `font-bold` changes wrap on long Luganda/English labels.

---

# PART 6 — TYPOGRAPHY SYSTEM PROPOSAL

Conceptual only. Based on WAKA POS (touch, UGX, Home density, Sell), **not** a marketing site.

Do not enlarge Home tiles, POS product cards, or keypad type in VL-1.

| Role | Desktop size | Mobile size | Weight | Line-height | Tracking | Numeric behaviour |
|---|---:|---:|---:|---:|---:|---|
| WAKA Display | 30px (`text-3xl`) | 24px (`text-2xl`) | 700 | 1.2 | tight | No |
| Page Title | 24px | 20px | 700 | 1.25 | tight | No |
| Section Title | 18px | 16px | 700 | 1.3 | tight | No |
| Card Title | 16px | 14px | 700 | 1.25 | normal | No; truncate on Home |
| Body | 16px | 14px | 400 or 500 | 1.45 | normal | No |
| Supporting Text | 14px | 12–14px | 400 | 1.35 | normal | No |
| Metadata | 12px | 12px | 500 | 1.3 | normal | Tabular if dates/IDs |
| Label | 12px | 12px | 700 | 1.2 | wide + uppercase **or** 12px sentence muted — pick one per surface | No |
| Button Label | 14px (POS 16px) | 14px | 700 | 1 | normal | No |
| KPI Value | 20–24px | 18px | 700 | 1.1 | tight | `tabular-nums lining-nums` |
| Financial Value | 16px default; totals 24px | same | 700 | 1.1 | tight | tabular |
| Table Header | 12px | n/a (cards on phone) | 700 | 1.2 | wide uppercase | No |
| Table Value | 14px | 14px | 400; 700 for money | 1.3 | normal | tabular for UGX/qty |
| POS Product Name | 13px (Display Scale) | 13px | 700 | snug | normal | No; line-clamp keep |
| POS Price | 12px | 12px | 700 | snug | tight | tabular |
| Checkout Total | 24px (compact 18px) | 24px | 700 | 1 | tight | tabular |

**Home exception (compatibility):** keep current **rendered** sizes on tiles/hero/Reports (`text-sm`/`text-base` titles, `text-[10px]` liveStat labels, `text-[11px]` subtitles) until a dedicated Home visual pass with fold tests. Mapping `font-black` → `font-bold` **without size change** is the only Home type change that is a candidate for a later pilot (VL-3), not VL-1 if VL-1 is font-files-only.

**Do not** promote Home section titles back to `text-lg` — that was deliberately downsized for first-screen density.

---

# PART 7 — VISUAL TOKEN FORENSICS

## Colors (from `src/index.css` `:root`, light)

| Token | Value (HSL unless noted) | Role |
|---|---|---|
| Application background | `30 15% 96%` | Warm stone page |
| Primary surface (card) | `30 20% 99%` | Near-white card |
| Secondary / muted surface | `--muted` `30 12% 91%`; `--surface-muted` `30 12% 94%` | Recessed |
| Elevated | `--surface-elevated` `0 0% 100%` | Dialog step |
| Border | `30 14% 82%` | Warm gray |
| Primary text | `--foreground` `20 15% 12%` | Near-black warm |
| Secondary text | `--text-secondary` `20 12% 32%` | |
| Muted text | `--muted-foreground` `20 10% 44%` | Phase 29.1 AA note |
| Success / warning / danger | `--success` 152 72% 28%; `--warning` 38 92% 46%; `--danger` = destructive 0 72% 45% | Plus `*-muted` fills |
| WAKA brand accents | `--primary` `25 95% 53%` ≈ `#f97316`; cream `#fffaf5`; waka 50–950 scale | Identity |

Dark mode restates the same semantic names (deeper cards, lighter muted text). Marketing `mkt-*` is a **parallel** palette for public site — do not merge into POS tokens in VL-1.

## Geometry

| Primitive | Current |
|---|---|
| `--radius` | 0.875rem (14px) |
| Tailwind `rounded-xl` / `2xl` / `3xl` | radius −4 / +8 / +12 |
| Brand radius constants | sm 12px … 2xl 24px, pill |
| Borders | 1px `border`; POS fields sometimes `border-2` |
| Shadows | `--elev-shadow-sm/md`; `shadow-elev`, `shadow-waka-sm` |
| Spacing scale | 4 / 8 / 16 / 24 / 32 via `--space-*` |
| Card padding | `p-4 sm:p-5` enterprise; Home tiles `p-3.5 sm:p-4` |

## Interaction

| State | Current |
|---|---|
| Hover | `hover:bg-muted`, `hoverLift` md-only, card `hover:shadow-sm` |
| Active | `active:scale-[0.98]` / `0.99`, `active:bg-*` |
| Focus-visible | Global 2px ring + `themeUi.focusRing` |
| Disabled | `opacity-50` + `cursor-not-allowed` |
| Selected | Settings appearance `ring-2 ring-waka-200`; chips `chipActive` |
| Keyboard | `:where(...) :focus-visible` in `@layer base` |

## Inconsistencies

- `.waka-btn-primary` uses `font-black` + `bg-waka-600`; `themeUi.btnPrimary` uses `font-bold` + `bg-primary`.  
- Home health chips `min-h-[44px]` vs launcher status chips `min-h-[32px]` (`DesktopLauncherStatusBar`) — **32px is below the established 44px floor** (pre-existing; do not worsen).  
- `shadow-sm` (Tailwind default) vs `shadow-elev` mixed on cards.  
- Teal checkout CTAs (`bg-teal-700`) vs WAKA orange primary — **product color, not a VL-1 change**.  
- Legacy gradient `appearance="living"` still in `LivingDashboardCard` (previews); live Home uses enterprise + accent rail (SETTINGS-DISPLAY-1.3).

### SAFE GLOBAL TOKENS

- Document and load DM Sans 400/500/700 (and 600 if needed).  
- Treat `font-bold` as the operational emphasis weight.  
- Keep cream/orange/radius/8px spacing.  
- Keep `tabular-nums` on money.

### SHARED COMPONENT TOKENS

- Unify button weight (`font-bold`) between CSS utilities and `WakaButton`.  
- Unify table header to one role (12px vs 10px — **choose 12px only after desktop table density test**).  
- Prefer `shadow-elev` over mixed `shadow-sm` on enterprise cards.

### PAGE-SPECIFIC ONLY

- POS Display Scale (`--ds-*`) — Sell only.  
- Home tile min-heights, gutters, region order.  
- Teal pay buttons, keypad geometry.  
- Marketing `mkt-*`.  
- Admin Roboto.  
- Print Inter/monospace.

---

# PART 8 — COMPONENT RISK AUDIT

## LOW RISK (pilot candidates)

- Settings presentation (`SettingsPageHeader`, appearance cards) — after font files.  
- Informational empty states / `EnterpriseCard` titles already on `enterpriseType`.  
- Non-transactional dashboard copy that already uses `SectionTitle` / `Caption`.  
- Internal admin (Roboto) — **out of scope** for WAKA product VL unless explicitly included.

**Home labels:** theoretically low, **practically MEDIUM** because of fold (see Part 9). Pilot only as **weight-only** with screenshots at 390 and 1280×720.

## MEDIUM RISK

- Inventory lists / `EnterpriseDataTable` / `ResponsiveDataTable`.  
- Reports / profit / analytics KPI grids.  
- Forms (`EnterpriseTextField` non-POS).  
- AppShell header labels (don’t change heights).  
- Sales history rows (money weight).  
- Cash position **presentation** (many `font-black` instances — numeric scan risk).

## HIGH RISK

Investigate without changing placement, sequence, targets, keyboard flow, checkout state, or business logic:

| Area | Visual-only later (allowed in principle) | Must not change |
|---|---|---|
| Sell screen / `PosPage` | Weight 900→700; slightly quieter borders | Layout, Display Scale behaviour, product order |
| Product selection | Same type sizes; tabular prices | Card min-height, `line-clamp`, CTA 44px |
| Cart | Totals already hierarchical; weight only | Line qty buttons, swipe, virtualization |
| Payment / checkout | Label contrast | Keypad, tender buttons, mixed pay |
| Keypad | — | Key size, `min-h`, decimal rules |
| Barcode | — | Scan handlers |
| Printer | — | IPC / ESC/POS |
| Keyboard shortcuts | — | `desktopPosKeyHandlers` |
| Transaction totals | Tabular + 700 | Payable computation, `data-testid` |

---

# PART 9 — HOME COMPATIBILITY

Confirmed in code (HOME-DENSITY-1.1 / 1.2):

| Constraint | Evidence | VL impact |
|---|---|---|
| Shared-tree Home | `DesktopHomeTiles` + `HomeOrderedRegions` | No second mobile UI |
| `resolveHomeRegionOrder` / `visibleHomeRegionOrder` / `resolveHomeRegionLayout` | `src/lib/homePresentation.ts` | Do not reorder for “premium” |
| `useHomeRegionLayout()` | hook at lg/xl | Do not change breakpoints for type |
| Sell hero primary | `HomeBusinessHero` first in both orders | Don’t restyle CTA into a marketing billboard |
| Reports dedicated | `HomeReportsPreview`, after Primary on small, after Primary on large (after KPI/Health) | Don’t merge into tiles |
| Tile min-heights | 112 / 96 / 88 | **Do not raise** via larger type or padding |
| Settings honesty | `HomeMenuArrangePanel` + `resolveHomeSettingsRegionOrder` | Same type classes as live |
| Display Scale | AppShell Sell-only | Do not apply to Home |

### Changes that could accidentally harm Home

| Proposed VL idea | 390px | 1024×768 | 1280×720 | Electron |
|---|---|---|---|---|
| Larger greeting (`text-2xl`) | Extra ~8–12px; can push Primary | Packing already tight | Fold | Same |
| Section titles back to `text-lg` | Adds per-section | KPI pack + titles | Reports vs Primary | Yes |
| Tile title `text-base` on phone (drop `text-sm`) | Wrap → 2 lines → taller than 112px min | Grid | Grid | Yes |
| Subtitle 11px → 14px | line-clamp-2 taller | Yes | Yes | Yes |
| More card padding / shadows / gaps | HD-01 regression | Yes | Yes | Yes |
| `leading-relaxed` on tiles | Height | Yes | Yes | Yes |
| Weight-only `font-black` → `font-bold` | Usually **neutral or slightly shorter** | Test | Test | Test |

**Mitigation:** VL-3 Home pilot = **weight only** + screenshot diff; abort if any viewport gains a row or loses Primary on first screen.

---

# PART 10 — CROSS-PLATFORM AUDIT

| Viewport | Readability | Wrap / rows | Font rendering | Touch | Card density | Typography-change hazards |
|---|---|---|---|---|---|---|
| 390×844 | 10px labels are small but operational | Tile subtitle clamp-2 | Android synthesis of 900 is worst | 48px Sell, 112px tiles, 44px health | 2-col | Larger type → extra tile rows, Primary below fold |
| 430×932 | Same system | Slightly more width | Same | Same | Same | Same |
| 768×1024 | Still 2-col Home | More horizontal | OK | Same | Same | Don’t treat as “desktop type” |
| 1024×768 | `packExecutiveScan` KPI\|Health | Landscape height is the scarce axis | OK | Pointer + touch | 3-col modules | **Taller type clips Primary** |
| 1280×720 | `max-w-7xl`; 4-col | Fold is short | Electron Chromium | Pointer | Comfortable width, short height | Greeting/section size |
| 1440×900 / 1920×1080 | Measure caps at 1280 | Extra leftover is margin, not bigger type | OK | Pointer | Good | Don’t scale type with window |

Other hazards: clipped KPIs if MonoNumber grows; taller buttons if `py-*` increases (forbidden); table overflow if header 10→14px; iOS zoom if inputs drop below 16px (already guarded).

---

# PART 11 — ACCESSIBILITY

| Topic | Current | VL rule |
|---|---|---|
| Contrast | Phase 29.1 raised muted-foreground; status uses text + muted fill + often dots | Don’t lighten muted text for “premium gray” |
| Min practical size | 10px used on Home/POS chrome; WCAG doesn’t forbid it but **operational strain** | Don’t add more 10px; don’t raise Home 10px in VL-1 |
| Hierarchy | Over-use of black weight reduces hierarchy | **Improve** by using 700 vs 400 |
| Focus | Global focus-visible 2px | Keep; don’t replace with color-only |
| Financial values | `tabular-nums` often; not universal | Extend, don’t fancy-italic money |
| Status not color-only | `statusTokens` dots + labels | Keep |
| Touch | 44 / 48 / 52 floors in tokens; some 32px chips | Don’t shrink; don’t grow so fold breaks |

Do not recommend light-weight gray body on cream that fails AA. Do not recommend display fonts for PIN/keypad.

---

# PART 12 — PERFORMANCE (if weights are added later)

| Topic | Finding |
|---|---|
| Current file count | 2 DM Sans + 4 Roboto CSS imports |
| Adding 500 (and 600) | +1–2 woff2; typical DM Sans latin static is small | Acceptable |
| Variable font | One `wght` file can replace 400/500/600/700; **watch** `font-optical-sizing` + POS; test FOIT |
| WOFF2 | `@fontsource` v5 ships woff2 — confirm on implement |
| Preload | Optional for 400/700 already critical; don’t preload 9 weights |
| FOUT/FOIT | Current body stack falls back to Inter/system; extra weights should `font-display: swap` (fontsource default — verify) |
| Offline / Electron | Local packages already the right model — **do not add Google Fonts runtime** |
| Capacitor | Extra fonts copy into `android`/`ios` www — keep latin subset only |

No implementation in this phase.

---

# REQUIRED FINAL VERDICT

## 1. EXECUTIVE VERDICT

**CONDITIONAL GO** — implementation is possible after resolving named risks:

1. **Weight/file mismatch** (DM Sans 400/700 vs classes 500/600/900).  
2. **Dual type systems** (`enterpriseType` vs global `font-black`).  
3. **Home fold** — no size/padding/order changes in the first phase.  
4. **Unverified reference font** — do not introduce a new family.  
5. **POS/checkout** — out of VL-1 except later forensic weight-only.

The token and component **foundation exists**. The gap is **adoption and font loading**, not a missing design system.

## 2. WHAT WAKA SHOULD KEEP

- DM Sans as the product face; Roboto for internal admin only.  
- Warm cream page, orange primary, W mark, no cloned competitor palette.  
- Semantic CSS variables and `themeUi` / Enterprise components.  
- 8px spacing scale; `--radius` 0.875rem; quiet elevation.  
- Touch floors 44 / 48 / 52; Home tile 112 / 96; Reports 88; Sell CTA 48.  
- HOME-DENSITY-1.1 measure (`max-w-7xl`) and HOME-DENSITY-1.2 shared region order.  
- Sell as locked hero; Reports as `HomeReportsPreview`.  
- `tabular-nums` on money; Display Scale **Sell-only**.  
- Status tokens with muted fills + labels/dots.  
- Lucide icons, stroke 2, Home accent wells + 4px rail (not gradients on live tiles).  
- iOS 16px input floor.

## 3. WHAT WAKA SHOULD ADAPT

**Typography**

- Load real 500 (and 600 if needed); stop relying on synthetic 900.  
- Prefer `enterpriseType` / 700 for titles; reserve extra-black for true display (or drop it).  
- Keep POS/Home **sizes**; change weights first.

**Surfaces**

- Use `themeUi.surface` / `EnterpriseCard` more; fewer one-off `rounded-2xl border` copies.  
- Don’t add marketing whitespace.

**Borders/shadows**

- Prefer `border-border` + `shadow-elev` consistently; don’t thicken POS borders.

**Icons**

- Keep wells; don’t enlarge Home wells (36px) in VL-1.

**Buttons**

- One weight (`font-bold`) across `WakaButton` and `.waka-btn-*`.  
- Don’t change min-heights.

**Spacing**

- Keep Home `HOME_MODULE_SECTION_SPACING` and gutters.  
- Enterprise pages already have `pageStack` — adopt rather than invent.

## 4. WHAT WAKA SHOULD NOT COPY

- Another POS/dashboard **logo, orange-to-blue palette, illustration pack, or layout**.  
- Pixel-for-pixel cards, sidebar OS chrome, or marketing hero type on Sell.  
- A trendy variable display face for product names and UGX.  
- Large airy dashboards that push Inventory below the fold.  
- Gradient tile art as the live Home language (already retired).  
- Inter-as-brand just because a receipt CSS string or an unloaded fallback mentions it.

## 5. FONT VERDICT

- **KEEP CURRENT** (DM Sans) — **do not CHANGE family**.  
- **TEST CANDIDATES:** none required. Optional later (only if A fails visually): metric-similar grotesques — **not selected**.  
- Exact recommendation: **DM Sans 400 + 500 + 700** local `@fontsource`; map UI emphasis to 700; keep stack with Inter/system fallbacks.  
- Confidence: **high** that the family should stay; **high** that 900 is unloaded; **medium** that `font-black`→`font-bold` never wraps (must screenshot).  
- Evidence: `src/main.tsx` imports; `package.json`; body/Tailwind/brandTokens stacks; widespread `font-black`.  
- Risks: wrap on long labels; Android WebView weight rendering; extra woff2 bytes.  
- **EXACT FONT (reference): UNVERIFIED.**

## 6. PROPOSED WAKA DESIGN TOKENS

Conceptual names only:

- **Type roles:** Display, PageTitle, SectionTitle, CardTitle, Body, Supporting, Metadata, Label, Button, Kpi, Financial, TableHeader, TableValue, PosName, PosPrice, CheckoutTotal (Part 6).  
- **Weight tokens:** Regular 400, Medium 500, Bold 700. No 900 in the product UI token set.  
- **Color:** keep existing CSS variables; do not add a second primary.  
- **Elev:** sm/md only.  
- **Radius:** keep `--radius`.  
- **Motion:** keep `enterpriseMotion` / `transition-waka`.

## 7. ROLLOUT ORDER

| Phase | Scope | Notes |
|---|---|---|
| **VL-1** | Typography foundation | Font files 500 (+600); document weight policy; **no** component restyle; **no** Home/POS class churn |
| **VL-2** | Shared visual tokens | Align `.waka-btn-primary` with `themeUi`; optional `shadow-elev` consistency — test Settings + one form |
| **VL-3** | Low-risk Home pilot | **Weight-only** on greeting/tile titles if VL-1 looks correct; fold tests 390 / 1024×768 / 1280×720; Settings preview honesty |
| **VL-4** | Shared components | `WakaButton`, `EnterpriseCard`, `EnterprisePageHeader`, dialog titles |
| **VL-5** | Inventory / Reports / Settings | Tables header unification; KPI `MonoNumber`; still no checkout |
| **VL-6** | Sell/POS forensic | Weight + tabular only; Display Scale regression; keypad untouched geometrically |
| **VL-7** | Physical-device certification | Real phone + Electron + Android WebView |

Adjusted vs the suggested template: **VL-1 is font loading + policy**, not Home, because Home is fold-critical and POS is unsafe until weights exist.

## 8. DO-NOT-TOUCH LIST (first implementation phase / VL-1)

- `src/pages/PosPage.tsx` and checkout/payment flow.  
- `src/components/pos/PosCheckoutPanel.tsx`, keypad, `DraftCartTotalsStack` logic, `usePosStore` totals.  
- `src/lib/desktopPosKeyHandlers.ts`, barcode, printer IPC (`electron/hardware/**`).  
- `src/lib/homePresentation.ts` region order, grids, min-heights, gutters.  
- `src/hooks/useHomeRegionLayout.ts`, `HomeOrderedRegions.tsx` order.  
- Sell hero unlock / Display Scale applying to Home.  
- Auth, PIN, lock screen behaviour (`EnterpriseStaffLockScreen` logic).  
- Sync, local DB, RLS, migrations, Supabase functions.  
- `src/store/usePosStore.ts` business logic.  
- Tailwind color/radius theme (VL-1).  
- `lovable-import/**`.  
- Marketing `mkt-*` unless a separate marketing VL.  
- Tests changed only to “prove” the audit.

Allowed in VL-1 **if implemented later:** `src/main.tsx` font imports + this doc’s follow-up; optionally `enterpriseTypography.ts` comments only — **prefer font CSS only** so class names don’t shift wrap.

## 9. IMPLEMENTATION READINESS SCORE

| Area | Score /100 | Notes |
|---|---:|---|
| Typography readiness | **78** | Roles exist; files incomplete; adoption incomplete |
| Token readiness | **82** | Strong `:root` / `themeUi`; dual button utilities |
| Component consistency | **58** | Enterprise vs ad-hoc `font-black` |
| Home compatibility | **86** | Clear constraints; VL must not fight 1.1/1.2 |
| POS safety | **40** | Safe only if VL-1 ignores Sell |
| Cross-platform confidence | **70** | Local fonts good; 900 synthesis on Android untested |
| Accessibility confidence | **74** | Focus + status tokens good; 10px chrome; contrast device-unchecked |
| **Overall readiness** | **72 / 100** | CONDITIONAL GO for VL-1 font foundation |

## 10. NEXT IMPLEMENTATION PROMPT

Copy-paste for the first controlled phase (**do not run as part of this audit**):

```
# WAKA POS — VL-1 TYPOGRAPHY FOUNDATION (IMPLEMENTATION)

MODE: small, reversible, testable. Shared-system only.

DO NOT: change POS/checkout/sync/auth/DB; do not change Home region order,
tile min-heights, gutters, or grids; do not change Tailwind theme colors/radius;
do not change button min-heights; do not introduce a new font family;
do not add Google Fonts; do not restyle Sell.

GOAL: Make WAKA’s existing DM Sans render with real weights so hierarchy can
be refined later.

1. Keep family: DM Sans with current fallback stack.
2. In src/main.tsx, add @fontsource/dm-sans files for weight 500, and 600
   if enterpriseType.caption remains font-semibold. Do not add 900.
3. Confirm latin WOFF2, font-display, and that Roboto admin imports stay.
4. Do not mass-replace font-black in this phase (wrap risk). Document in
   docs/WAKA_VL_1_TYPOGRAPHY_FOUNDATION.md that VL-3/4 will map font-black →
   font-bold after screenshot sign-off.
5. Add a short comment in enterpriseTypography.ts only if needed: loaded
   weights are 400/500/700 (/600).
6. Verify: tsc -b; existing enterpriseTypography tests; npm run build;
   visual before/after at 390×844 and 1280×720 on Home (greeting + one tile)
   and one Settings page. Electron smoke if available.
7. Abort if Home first-screen composition changes or inputs fall below 16px
   on iOS.

Reference audit: docs/WAKA_TYPOGRAPHY_VISUAL_LANGUAGE_AUDIT.md
```

---

# REQUIRED TEST / VERIFICATION PLAN (eventual implementation)

Viewports: **390×844, 430×932, 768×1024, 1024×768, 1280×720, 1440×900, 1920×1080**.

| Check | VL-1 | Later VL |
|---|---|---|
| `tsc -b` | Yes | Yes |
| `src/lib/enterpriseTypography.test.ts` | Yes | Yes |
| `src/lib/homePresentation.test.ts` | Must stay green (no logic edits) | Yes |
| `src/lib/homeTileAccent.test.ts` | Untouched | Yes |
| Production `npm run build` | Yes | Yes |
| Visual before/after (Home greeting, tile, Settings header, one table if VL-5) | Home + Settings | All listed viewports |
| Electron packaged UI | Smoke | VL-7 |
| Real phone (Android WebView + iOS) | Before GO on weights | VL-7 |
| Sell / keypad / payable | Screenshot-only, no interaction change | VL-6 |
| Contrast spot-check muted text on cream | Device | VL-7 |

---

# APPENDIX — EVIDENCE SNIPPETS

Font loading (`src/main.tsx`):

```text
@fontsource/dm-sans/400.css
@fontsource/dm-sans/700.css
@fontsource/roboto/400.css | 500.css | 700.css | 900.css
```

Declared product roles (`src/lib/enterpriseTypography.ts`): display, pageTitle, sectionTitle, body, caption, monoNumber — titles `font-bold`; body `font-medium`; caption `font-semibold`; POS `micro` `text-[10px]`; `shelfPrice` still `font-black`.

Home greeting (`src/pages/DesktopHomePage.tsx`): `text-lg font-black … sm:text-xl`.

This audit does not treat “looks premium” as “better for a POS.” Coherence is the goal; **speed, UGX clarity, touch, and transaction reliability stay first.**
