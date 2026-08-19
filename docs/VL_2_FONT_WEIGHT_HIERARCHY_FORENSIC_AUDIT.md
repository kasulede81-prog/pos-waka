# VL-2 — Font Weight Hierarchy Forensic Audit

**Date:** 2026-08-19  
**Mode:** FORENSIC AUDIT ONLY — no source, class, token, CSS, Tailwind, font, or layout changes.  
**Baseline:** `docs/WAKA_TYPOGRAPHY_VISUAL_LANGUAGE_AUDIT.md` + VL-1 (`docs/VL_1_DM_SANS_WEIGHTS_IMPLEMENTATION.md`)

VL-1 loaded DM Sans **400 / 500 / 600 / 700**. **900 was not loaded.** `font-black` (Tailwind 900) still exists in code and **does not have a real DM Sans file**. Browsers synthesize extra-bold from 700 or snap toward 700. That fact is central to this audit: VL-2 is not “make the POS skinny.” It is “stop shouting everywhere so the few things that matter can be read under pressure.”

Physical-device measurement was **not** performed.

---

## PRIMARY ANSWER

WAKA overuses **900-intent** (`font-black`) as a general “this is UI text” switch. It appears **2,230** times in **470** files — more than `font-bold` (1,354) or `font-semibold` (1,059). The declared system (`enterpriseType`, `themeUi`) already prefers **700** for titles and numbers. Production screens ignore that contract.

Heavy type **is justified** for checkout payable, cart line money, POS prices, keypad digits, and a small set of large KPI totals. It is **not** justified for muted uppercase section labels, chip chrome, Settings field titles, Home tile names competing with live stats, or every secondary button.

Controlled refinement can create a calmer hierarchy **without** thinning transaction-critical numbers and **without** changing sizes, spacing, Home density, or Sell flow.

**Do not bulk-replace 2,230 classes.** Stage a tiny VL-2.1 on low-risk informational chrome first. Protect POS/checkout until that proves wrap-safe.

---

# PART 1 — CURRENT TYPOGRAPHY WEIGHT INVENTORY

Counts are occurrence totals in `src/` (`.ts` / `.tsx` / `.css`), excluding `lovable-import`. Same method as VL-1.

## Tailwind classes

| Class | Count | Files | Main usage areas |
|---|---:|---:|---|
| `font-black` | **2230** | **470** | Default “emphasis” across POS, admin, pharmacy, settings, inventory, hospitality, marketing, owner/command center. Home only **18**. |
| `font-extrabold` | **0** | 0 | Unused |
| `font-bold` | **1354** | **395** | `enterpriseType` titles, `themeUi` buttons/table heads, `statusTokens` badges, Home Sell CTA / shop name / health chips, some POS stock labels |
| `font-semibold` | **1059** | **385** | `enterpriseType.caption`, checkout subtotal rows, Home supporting lines, banners, table secondary cells |
| `font-medium` | **379** | **195** | `enterpriseType.body`, Home greeting subtitle, tile subtitles, Settings hints |
| `font-normal` | **0** | 0 | Body default (400) without an explicit class |

**Loaded vs requested (after VL-1):**

| Requested | Tailwind | Real DM Sans file? |
|---|---|---|
| 400 | default / (no `font-normal`) | Yes |
| 500 | `font-medium` | Yes |
| 600 | `font-semibold` | Yes |
| 700 | `font-bold` | Yes |
| 800 | `font-extrabold` / raw 800 | No (unused in Tailwind; 2 raw print/crash uses) |
| 900 | `font-black` | **No** |

## Raw `font-weight` / `fontWeight` (not Tailwind)

| Weight | Hits | Where |
|---|---:|---|
| 900 | 4 | `PosShelfTile.tsx` (shelf title); `receiptPrint.ts` (header/grand); `productLabelPrint.ts` (price) |
| 800 | 2 | Crash boundary title; product label name |
| 700 | 6 | Crash buttons; receipt lines; monthly report; admin map popup |
| 600 | 2 | `PosShelfTile` count; receipt “powered” |
| 500 | 1 | Receipt policy line |

`src/index.css` has **one** `font-black` utility: `.waka-btn-primary`. Canonical `WakaButton` / `themeUi.btnPrimary` use **`font-bold`**. That split is a hierarchy bug, not a POS requirement.

---

# PART 2 — WEIGHT USAGE MAP

`font-black` by product area (occurrence counts):

| Area | Count | Notes |
|---|---:|---|
| other (staff, EOD, upgrade, sync, investigation, hardware, …) | 649 | Diffuse; many card titles + chips |
| internal_admin | 344 | Oversight UI; Roboto `font-admin` — out of WAKA POS VL-2.1 |
| **pos** | **228** | Checkout 28, PosPage 26, cart lines 14, product cards, shelf |
| pharmacy | 176 | Ops dashboard 27, patient profile 21 |
| settings | 135 | Forms, diagnostics, Cloud Trust |
| inventory / stock | 132 | Names, money cells, toolbars |
| hospitality | 128 | Bill sheet 20, tickets, floor |
| marketing / public | 117 | Website — **not POS**; do not mix into VL-2.1 |
| owner / command center | 114 | Financial sections, KPIs |
| reports / analytics | 68 | AnalyticsModeReports 29 |
| cash / cash-position | 62 | Dense UGX |
| enterprise shared | 21 | Relatively disciplined |
| **home** | **18** | Small, high leverage for a pilot |
| auth | 17 | |
| sales history | 13 | |
| layout / shell | 8 | |

Line-level **heuristic** (imperfect; one line can mix roles):

| Heuristic bucket | ~Count |
|---|---:|
| Card title / body emphasis (`text-sm`/`text-base` + black) | 515 |
| Uppercase labels / meta | 365 |
| Buttons / CTAs | 260 |
| Headings (`text-lg`+) | 242 |
| Small chrome (`text-xs` / 10–11px) | 226 |
| Unclassified | 238 |
| Money/KPI (`tabular-nums`) | 161 |
| Badges / pills | 117 |
| Display / totals (`text-2xl`+) | 106 |

## 900 / `font-black`

| Weight | Component | Purpose | Frequency | Initial judgement |
|---|---|---|---|---|
| 900 | `PosCheckoutPanel` | Pay CTA, keypad chrome, amount fields | 28 in file | **KEEP** on payable/pay; REVIEW keypad chrome |
| 900 | `PosPage` | Sell chrome | 26 | HIGH RISK — do not batch |
| 900 | `DraftCartLineRow` | Qty, line UGX, qty stepper, void | 14 | **KEEP** money/qty; buttons REVIEW |
| 900 | `DraftCartTotalsStack` | Payable + change + “TOTAL” label | 3 | **KEEP** payable; label could be 700 |
| 900 | Product cards | Name + price + badges | 4+4 | **KEEP** price; name KEEP for scan; badge → 700 |
| 900 | `PosShelfTile` inline 900 | Shelf title | 1 raw | KEEP until POS pass |
| 900 | `LivingDashboardCard` | Tile title, liveStat, badge | 5 | Title → 700 candidate; liveStat REVIEW; badge KEEP |
| 900 | Home greeting | `h1` | 1 | → 700 |
| 900 | Settings arrange panel | Section titles, color chips | 7 | → 700 / 600 |
| 900 | `.waka-btn-primary` | CSS primary button | 1 utility | → 700 to match `WakaButton` |
| 900 | Owner/cash-position | Financial headings + values | high | Values KEEP; headings → 700 |
| 900 | Marketing site | Marketing headlines | 30+ in one file | Out of POS scope |
| 900 | Internal admin | Ops widgets, campaigns | 344 area | Out of POS VL-2.1 |

## 700 / `font-bold`

| Weight | Component | Purpose | Frequency | Initial judgement |
|---|---|---|---|---|
| 700 | `enterpriseType` display/page/section/monoNumber | Declared hierarchy | 6 role strings | **KEEP** — this is the target |
| 700 | `themeUi` buttons, tableHead, links | Shared controls | ~10 token strings | KEEP |
| 700 | Home Sell CTA, shop name, health chips | Primary actions / identity | few | KEEP |
| 700 | `statusTokens` badges | Status (not color-only) | badge base | KEEP |
| 700 | Enterprise data table headers | 10px uppercase | few | KEEP (already quieter than black) |

## 600 / `font-semibold`

| Weight | Component | Purpose | Frequency | Initial judgement |
|---|---|---|---|---|
| 600 | `enterpriseType.caption` | Small uppercase labels | token | KEEP or later 500 if captions still shout |
| 600 | Checkout subtotal rows | Secondary money | `DraftCartTotalsStack` | KEEP |
| 600 | Home supporting | Hero meta, license detail | few | KEEP |
| 600 | Banners | `statusTokens` banner | token | KEEP |

## 500 / `font-medium`

| Weight | Component | Purpose | Frequency | Initial judgement |
|---|---|---|---|---|
| 500 | `enterpriseType.body` | Body | token | KEEP |
| 500 | Home tile subtitle, greeting sub | Supporting | few | KEEP — this is the quiet layer |

## 400 (default)

| Weight | Component | Purpose | Frequency | Initial judgement |
|---|---|---|---|---|
| 400 | Unclassed text, inputs (`themeUi.input`) | Body / fields | implicit | KEEP; do not force medium on all body |

---

# PART 3 — DEFINE TYPOGRAPHY ROLES

Proposal only. Sizes stay as today unless a later phase says otherwise.

| Role | Current typical | Recommended weight | Acceptable range | Reason |
|---|---|---|---|---|
| WAKA Display | Often `font-black` + `text-2xl`/`3xl` | **700** | 700 only | Real 700 is the heaviest **loaded** face. Fake 900 is inconsistent. |
| Page Title | Mix black / `pageTitle` 700 | **700** | 700 | Screen identity; already in `enterpriseType` |
| Section Title | Home downsized 700; elsewhere black | **700** | 600–700 | Grouping, not shouting |
| Card Title | `text-sm font-black` everywhere | **700** | 600–700 | Module ID; 900 competes with KPIs |
| Body | `font-medium` or unclassed | **400–500** | 400–500 | Information, not emphasis |
| Supporting | `font-medium` muted | **400–500** | 400–500 | Descriptions stay quiet |
| Metadata / labels | `font-black uppercase` on muted 10–12px | **600** | 500–700 | Uppercase + color already signal “label” |
| Button label | Mix `font-bold` tokens vs `font-black` CSS | **700** | 700 | One button weight; size/color carry CTA |
| Badge / chip | `font-black` on 10px | **700** | 600–700 | Legible; not a total |
| KPI value | Mix black + `MonoNumber` 700 | **700** + tabular | 700–900* | *900 only if a **scoped** display face is loaded later |
| Financial value (lists) | `font-black tabular-nums` | **700** tabular | 700 | Alignment > extra-black |
| Checkout total / payable | `text-2xl font-black tabular-nums` | **KEEP 900-intent or 700+size** | 700–900 | Strongest number on the ticket |
| POS product name | `font-black` 13px/14px | **KEEP 700 minimum; do not thin below 700** | 700–900 | Scan speed |
| POS price | `font-black tabular-nums` | **KEEP** | 700–900 | Transaction clarity |
| Table header | `font-bold` or `font-black` | **700** | 600–700 | Already small uppercase |
| Table value | mix | 400; **700** for money | 400–700 | Quiet rows, loud money |

\* Loading 900 globally is still **not** recommended. If checkout totals ever need true black, that would be a **scoped** `@font-face` for a total class — not 2,230 imports. Out of VL-2.1.

---

# PART 4 — FONT-BLACK FORENSIC REVIEW

## KEEP 900-intent (do not thin in VL-2.1)

Verified as operationally loud **on purpose**:

| Case | Evidence | Why keep |
|---|---|---|
| Checkout payable | `DraftCartTotalsStack` `text-2xl font-black tabular-nums` | Cashier/customer must not miss the amount due |
| Change due | same file, success chip | Money consequence |
| Cart line UGX / qty | `DraftCartLineRow` multiple `font-black tabular-nums` | Fast qty/price scan |
| POS product price | `PosSellProductCard` / `PosDesktopProductCard` | Price is the decision |
| POS product name | same, `line-clamp-3` | Dense catalog; thinning names hurts scan |
| Pay / complete sale CTAs | `PosCheckoutPanel` success buttons `font-black` | Action of record |
| Keypad digit glyphs | `text-2xl font-semibold` already (not all black); amount field `text-3xl font-black` | Numeric entry |
| Shelf title raw 900 | `PosShelfTile` `fontWeight: 900` | POS chrome; later POS pass only |
| Danger badge counts | Home tile badge; cart qty badges | Small, high-contrast counts |
| Print thermal header/grand | `receiptPrint.ts` 900 | Print, not app VL-2.1 |

**Caveat:** these classes request 900 but **no 900 file exists**. They already render as synthetic-from-700. “KEEP” means **do not restyle these components in VL-2.1**, not “add a 900 file.”

## CHANGE CANDIDATES

### Candidate → 700

Where importance is real but extra-black is the default shout:

- Home greeting `h1` (`DesktopHomePage`)
- Home module **titles** (`LivingDashboardCard` live enterprise appearance)
- Home Reports “open” chevron label (`text-xs font-black`)
- License bar product line
- Subscription banner headline (not a KPI)
- Settings Home arrange titles / preview headings
- Muted uppercase **section labels** currently `font-black` (investigation, inventory, Settings)
- `.waka-btn-primary` → match `WakaButton` `font-bold`
- Owner/command-center **card titles** (not the UGX figure)
- Settings appearance option titles (`text-base font-black`)
- `statusTokens` save-state overrides that force `font-black` on badges already `font-bold`

### Candidate → 600

- Home arrange “uppercase tracking” muted labels (`text-xs font-black uppercase`)
- Color-chip captions in Settings
- Filter chips that are not selected state
- Sync/health secondary headings that are already uppercase

### Candidate → 500

- Supporting sentences currently `font-black` by habit (rare; most supporting is already `font-medium`)
- Do **not** drop POS prices or totals to 500

### REVIEW

- Home tile **liveStat values** (`text-sm font-black tabular-nums`) — owner scan vs competing with tile title. Prefer title 700 + value 700 tabular first; don’t send value to 500.
- Cash position section values — financial, but many headings are also black; split heading vs number in a later VL-2.x.
- Hospitality bill sheet / production tickets — operational, treat like POS until a dedicated pass.
- Internal admin / marketing — **out of WAKA POS VL-2.1**.

---

# PART 5 — SCREEN-BY-SCREEN AUDIT

## 1. HOME

| Element | Weight today | Competing? |
|---|---|---|
| Greeting | `font-black` 18/20px | Yes vs shop name (already `font-bold`) |
| Greeting sub | `font-medium` | Quiet — keep |
| Shop name (hero) | `font-bold` | Correct |
| Sell CTA | `font-bold` 48px min | Correct; primary by **color + size**, not 900 |
| Hero meta | 10px semibold/bold | Fine |
| KPI strip titles | `SectionTitle` → **700** downsized | Relatively correct |
| Health chips | `font-bold` 11px, 44px min | Fine |
| Reports liveStat | MonoNumber + `font-bold` trend | Better than tiles |
| Reports affordance | `text-xs font-black` | Unnecessarily heavy |
| Module titles | `font-black` | **Compete with liveStat** (also black) |
| Module subtitle | `font-medium` 11px | Quiet — keep |
| Tile liveStat | `font-black` tabular | Should win over title; today they match |
| Status bar chips | `font-black` 11px | Chrome shouting |

**Everything visually competing?** Yes among greeting, tile titles, liveStats, license bar, subscription banner — all black-intent.

**KPIs stronger than modules?** Executive KPI uses `SectionTitle` (700). Module titles use 900-intent. Modules can **out-shout** KPIs. Wrong for an owner morning scan.

**Card titles too heavy?** Yes relative to subtitles (already quiet).

**HOME-DENSITY-1.1 / 1.2:** Weight-only `black` → `bold` on titles/greeting **must not** change min-heights (112/96/88), gutters, region order, or packing. Synthetic 900 → real 700 may even be **slightly narrower**. If wrap increases, **stop** — do not add padding or drop `text-sm`.

Do not recommend larger type or more line-clamp rows.

## 2. SELL / POS — HIGH RISK

| Element | Typical weight | Recommendation |
|---|---|---|
| Product name | black | **KEEP** (min 700) |
| Price | black tabular | **KEEP** |
| Stock chip | `font-bold` | KEEP |
| Catalog badges | black 8–11px | Optional 700 later; not VL-2.1 |
| Cart qty / line total | black | **KEEP** |
| Qty steppers | black | KEEP (target + glyph) |
| Shelf title | raw 900 | KEEP |
| Operational nav | mixed | Later POS pass |

Protect cashier scan speed. **Do not reduce** names, prices, qty, or pay actions in VL-2.1.

## 3. CHECKOUT

| Element | Weight | Recommendation |
|---|---|---|
| Subtotal / tax / discount rows | `font-semibold` tabular | KEEP |
| TOTAL label | `font-black` uppercase | REVIEW → 700 (size already smaller than payable) |
| Payable | `text-2xl font-black` tabular | **KEEP** |
| Change due | black on success muted | KEEP |
| Payment method / complete | black on large success buttons | **KEEP** |
| Amount entry | `text-3xl font-black` | KEEP |

Large money **may** stay the heaviest element on the ticket. Hierarchy here should be: payable loudest, rows quieter (already semibold). Do not flatten payable to body.

## 4. REPORTS

`ReportsPage.tsx` itself has no `font-black`. Weight lives in analytics widgets (`AnalyticsModeReports` 29), profit cards, pharmacy ops (27). Headings often black; some values already `tabular-nums` without a shared `MonoNumber` role.

**VL-2.1:** do not start here. **VL-2.2+:** titles 700, values 700 tabular; keep large KPI figures strong.

## 5. SETTINGS

`SettingsPageHeader` → `EnterprisePageHeader` → `pageTitle` **700**. Many nested cards still `font-black` (appearance options, Home arrange, Cloud Trust 17, floor 14).

**Good VL-2.1 pool:** Settings informational titles and muted uppercase labels. Not PIN, not cash-drawer numeric fields.

## 6. TABLES / FORMS

| Surface | Weight | Recommendation |
|---|---|---|
| `themeUi.tableHead` / `.waka-data-table` th | `font-bold` uppercase | KEEP |
| `EnterpriseDataTable` headers | `font-bold` 10px | KEEP |
| Money `<dd>` cells | often `font-black tabular-nums` | Later → 700 tabular |
| `EnterpriseTextField` label | forced `font-bold` | KEEP |
| Input text | 400, 16px / POS 24px black | POS inputs HIGH RISK |

---

# PART 6 — PREMIUM REFERENCE COMPARISON

**EXACT FONT (reference): UNVERIFIED** (same as visual-language audit). Compare hierarchy only.

| Area | Current WAKA | Reference characteristic | Gap | Risk |
|---|---|---|---|---|
| Emphasis budget | ~2230 black-intent vs 1354 bold | Few heavy nodes | Everything competes | Low if staged |
| Heading vs support | Titles and labels both black | Support quieter | Labels too loud | Low on Settings/Home labels |
| Numbers | Many black; checkout already hierarchical | One loud total | Lists over-black | Medium if totals thinned |
| Buttons | Token 700 vs CSS 900 | One CTA weight | Inconsistent | Low to align to 700 |
| Home | Tile title = liveStat weight | Number wins | Scan noise | Fold if size changes — **don’t change size** |
| POS | Names+prices+buttons all black | Price/total win | Correct to keep POS loud | **High** if thinned |

---

# PART 7 — POS SAFETY ANALYSIS

| Recommended change | Risk | Why |
|---|---|---|
| Home greeting `black` → `bold` | **LOW** | Not transactional; one line |
| Home tile title `black` → `bold` | **MEDIUM** | Fold/wrap; screenshot 390 + 1280×720 |
| Home liveStat value | **MEDIUM** | Owner metric; keep tabular 700+ |
| Settings labels/titles | **LOW** | Informational |
| `.waka-btn-primary` → `font-bold` | **LOW–MED** | Shared utility; don’t change min-height |
| Reports card titles | **MEDIUM** | Later phase |
| Table money cells | **MEDIUM** | Readability of UGX |
| POS product name/price | **HIGH** | Scan + Display Scale |
| Cart qty/money | **HIGH** | Error cost |
| Checkout payable / pay CTA / keypad amount | **HIGH** | Tender mistakes |
| Auth PIN / lock copy | **HIGH** | Don’t mix into VL-2.1 |

---

# PART 8 — CROSS PLATFORM IMPACT

No physical testing in this audit. Weight-only (900-intent → 700) **usually** slightly reduces glyph width vs synthetic extra-bold. Worst case: a few labels wrap one extra line.

| Surface | Risk if VL-2.1 is Home/Settings titles only | Risk if POS/checkout included |
|---|---|---|
| 390×844 | Tile title wrap → height vs 112px min; first-screen | Product `line-clamp-3`; button text |
| 430×932 | Same, slightly better width | Same |
| 768 / 1024×768 | KPI pack + titles | Catalog density |
| 1280×720 | Short fold; greeting one line | Desktop POS header |
| 1440 / 1920 | Low | Tables |
| Electron | Same Chromium files as VL-1 | Rendering of synthetic 900 vs 700 |
| Capacitor | Android often ugliest synthetic 900 — **700 may look cleaner** | WebView wrap |

---

# PART 9 — ACCESSIBILITY REVIEW

- Reducing **fake 900 → real 700** generally **improves** stroke evenness; it is not “thin text.”
- Do **not** recommend 300/400 for money, buttons, or 10px chrome.
- Status already uses fill + label + often a dot (`statusTokens`). Don’t rely on weight alone; don’t remove badges.
- Hierarchy should use **size + color + weight** together (Sell CTA already does).
- 10px `font-black` labels: changing to 600/700 does not fix small size; **do not enlarge** in VL-2 (Home fold).
- Focus rings unchanged; out of scope.

---

# PART 10 — IMPLEMENTATION READINESS

| Area | Score | Notes |
|---|---:|---|
| Current hierarchy quality | **38** | Dual system; 900 used as default |
| Font usage consistency | **32** | 2230 black vs declared 700 titles |
| Home safety | **84** | Only 18 black hits; density constraints clear |
| POS safety | **90** | Safe **if POS is excluded** from first implementation |
| Report safety | **62** | Concentrated in widgets; not first |
| Accessibility confidence | **76** | 700 is loaded and AA-friendly; don’t go thin |
| Implementation readiness | **71** | Ready for a **tiny** VL-2.1, not a repo-wide replace |

---

# EXECUTIVE VERDICT

**CONDITIONAL GO — refinement possible with restrictions**

Hierarchy is understood well enough to pilot **weight-only** changes on **low-risk informational chrome**. It is **not** understood as a license to replace 2,230 `font-black` classes or to restyle Sell/checkout.

Restrictions:

1. No size, spacing, radius, or Home order changes.  
2. No POS product/price/qty/payable/pay-CTA/keypad changes in VL-2.1.  
3. No loading DM Sans 900.  
4. Screenshot 390 and 1280×720 Home before expanding.  
5. Stop if wrap/fold regresses — do not compensate with layout.

---

# WHAT SHOULD STAY HEAVY

- Checkout **payable** and **change due**
- Cart **line money** and **quantity**
- POS **product names** and **prices**
- Pay / complete-sale **primary actions**
- Numeric **amount entry** on checkout
- Large **KPI figures** (weight 700+ tabular; don’t drop to 500)
- Danger **counts** on small badges
- Sell **CTA** (already 700 + color + 48px — keep)
- PIN / keypad **digits** (readability)

---

# WHAT SHOULD BECOME QUIETER

- Home **greeting** (900-intent → 700)
- Home **module titles** (leave liveStat tabular strong)
- Muted **uppercase section labels** currently `font-black`
- Settings **card/option titles** and arrange-panel chrome
- CSS **`.waka-btn-primary`** (align to 700)
- Non-selected **chips** / filter chrome
- Owner/dashboard **headings** that sit beside UGX (later phase)
- Reports **widget titles** (later phase)

Supporting copy that is already `font-medium` / muted should **stay** quiet.

---

# DO NOT CHANGE LIST

- Home region ordering (`resolveHomeRegionOrder`, `visibleHomeRegionOrder`, `useHomeRegionLayout`)
- HOME-DENSITY-1.1 measure/gutters/min-heights/footer flow
- HOME-DENSITY-1.2 first-screen sequence and 1024–1279 packing
- Sell workflow, catalog interaction, Display Scale behaviour
- Checkout state, tender logic, keypad layout, barcode, printer IPC
- POS business logic, `usePosStore` totals
- Sync, auth, RLS, database, migrations
- Font family, VL-1 weight **files** (keep 400/500/600/700; still no 900)
- Touch targets, card min-heights, button min-heights
- Marketing site and internal-admin as part of POS VL-2.1

---

# VL-2 IMPLEMENTATION RECOMMENDATION

**Do not implement in this phase.**

## VL-2.1 — Controlled typography hierarchy refinement (proposed next)

**Goal:** Make supporting Home/Settings chrome use **real 700** instead of **unloaded 900**, so titles no longer tie with every label. Prove wrap-safety. Leave POS/checkout untouched.

### Smallest safe changes

1. `DesktopHomePage` greeting: `font-black` → `font-bold` (1 class).  
2. `LivingDashboardCard` **enterprise** tile title only (not liveStat, not badge, not legacy gradient appearance): `font-black` → `font-bold`.  
3. Home Reports affordance + license/subscription headlines: `font-black` → `font-bold`.  
4. `HomeMenuArrangePanel` informational titles/uppercase labels: `font-black` → `font-bold` (keep preview structure identical).  
5. Optional one-liner: `.waka-btn-primary` `font-black` → `font-bold` to match `WakaButton`.

**Not in VL-2.1:** `PosCheckoutPanel`, `DraftCart*`, product cards, `PosShelfTile`, cash-position values, marketing, internal-admin, global regex replace.

### Files likely involved

- `src/pages/DesktopHomePage.tsx`
- `src/components/home/LivingDashboardCard.tsx`
- `src/components/home/HomeReportsPreview.tsx`
- `src/components/home/DesktopLicenseBar.tsx`
- `src/components/home/DesktopSubscriptionBanner.tsx`
- `src/components/home/HomeMenuArrangePanel.tsx`
- Optionally `src/index.css` `.waka-btn-primary` only
- Docs: `docs/VL_2_1_WEIGHT_HIERARCHY_REFINEMENT.md`

### Testing required

- `tsc -b`
- `homePresentation.test.ts`, `homeTileAccent.test.ts`, `launcherTiles.test.ts`, `dmSansWeights.test.ts`
- Visual before/after: **390×844**, **1024×768**, **1280×720** Home (greeting, one tile, Reports, Settings preview honesty)
- Confirm tile `min-h-[112px]` / `96px` / Reports `88px` unchanged in source
- No POS screenshot required if POS files are untouched — still spot-check Sell once for accidental bundle-wide CSS (only if `.waka-btn-primary` is included)

### Rollback safety

Each change is a class-string swap. Revert the file(s). No data, no tokens, no font files. If wrap appears, revert that file only.

### After VL-2.1 (not now)

- VL-2.2 Settings/forms labels  
- VL-2.3 Reports/owner headings (not values)  
- VL-2.4 POS forensic weight pass (prices/totals stay heavy)

---

A premium POS is not one where every word is extra-bold. It is one where the cashier sees the price and the total, the owner sees the number that changed, and everything else stays out of the way.

Audit complete. Implement only after an explicit VL-2.1 go.
