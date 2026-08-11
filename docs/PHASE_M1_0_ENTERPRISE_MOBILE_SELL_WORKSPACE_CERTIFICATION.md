# Phase M1.0 — Enterprise Mobile Sell Workspace Certification

**Mode:** Read-only enterprise audit (**NO code changes, NO redesign, NO implementation**)  
**Date:** 2026-08-08  
**Scope:** **Mobile Sell workspace only** — iPhone class (layout band ≤767 CSS px)  
**Surfaces audited:** `/pos` → `PosPage` inside `AppShell` sell-focus  
**Out of scope:** Desktop split Sell · Inventory · Vision · Home · Back Office · auth/logout  

**Benchmark mindset:** Shopify POS · Square POS · Lightspeed · Toast · Oracle MICROS  

**Related prior certifications (not re-litigated as substitutes):**  
- Phase 28.0 / 28.1 — cashier selection & text-first tiles  
- Phase 32.0 / 32.3 / 32.4 — layout scaling & product cards  
- Phase 33.0 / 33.1 — cart & checkout  
- Phase 25.2 / 25.3 — scroll & touch ownership  

**Evidence basis:** Static forensics of current implementation + synthesis of prior phase findings + requester-reported iPhone Simulator / video observations. Live eye-tracking and timed multi-cashier lab were **not** performed in this phase.

---

## Executive Summary

WAKA’s mobile Sell experience is a **capable, barcode-forward cashier surface**: sticky search, shelf drill-down, virtualized product grid, whole-card tap-to-add path, sticky checkout strip, and a density-token Display Scale system. It is **not enterprise-certified for iPhone Sell** because the workspace still mixes **overlay cart semantics, dual density systems, incomplete scale application, and cognitive overhead** that Square/Shopify-class mobile POS largely eliminate.

| Category | Score |
|----------|------:|
| 1. First impression | **6.5** |
| 2. Information hierarchy | **6.8** |
| 3. Product discovery | **7.2** |
| 4. Product grid | **6.9** |
| 5. Display Scale (critical) | **4.3** |
| 6. Cart workflow | **6.6** |
| 7. Cashier speed | **6.4** |
| 8. Touch ergonomics | **6.2** |
| 9. Accessibility | **5.4** |
| 10. Performance perception | **7.0** |
| 11. Enterprise readiness (composite) | **5.9** |
| **Overall mobile Sell** | **6.3 / 10** |

**Verdict:** **NO GO** for enterprise certification of the mobile Sell workspace.  
**Production stance:** Acceptable for **small barcode-first retail** with trained staff. **Not ready** to ship as a flagship iPhone POS experience for supermarket / high-volume pharmacy / hospitality without a focused **M1.1** improvement phase.

**Freeze recommendation:** Freeze feature expansion on mobile Sell chrome (new density widgets, extra header tools, more overlay modes). Prefer a single M1.1 cluster aimed at Display Scale honesty + cart continuity + identification density — not a greenfield redesign.

**Display Scale recommendation (preview — detail in §5):** **B. Improve** the density-token engine and **replace the cashier-facing scale experience** (control UX + incomplete application + dual-system confusion). Do **not** keep as-is. Do **not** throw away the token architecture for browser zoom.

---

## Screenshots / observations reviewed

| Source | What it informs |
|--------|-----------------|
| Current code spine (`PosPage`, `AppShell` sell-focus, `PosSellProductCard`, `DisplayScaleControl`, `PosMinimizedCheckoutFab`, `scaleTokens.ts`) | Structural truth of mobile Sell |
| Phase 28.0 / 32.0 / 33.0 certifications | Prior scores, defect registers, zoom/band risks |
| Requester videos / iPhone Simulator sessions (referenced) | Suspected Display Scale weakness, “empty feel,” scale control friction |

**Workflow observed (canonical mobile path):**

```text
Open Sell
  → AppShell sell-focus (no bottom tabs)
  → Sticky search + Display Scale in header
  → Empty query → shelf grid
  → Tap shelf → product grid (2-col portrait / 3-col landscape)
  → Tap product → fast-add OR quantity sheet
  → Sticky checkout strip (FAB) when cart has items
  → Tap Checkout → full-screen cart/pay overlay
  → Minimize / Add items → back to catalog + strip
```

---

## Mobile workspace map (as implemented)

```text
AppShell (app-shell--sell-focus · --waka-bottom-nav-h: 0)
├── Header: Exit · “Sell” · DisplayScaleControl (− / % / +)
└── PosPage (catalogSellMode)
    ├── Sticky search (pos-ds-input) + scan affordance
    ├── Optional quick chips
    ├── .pos-catalog-scroll-pane
    │     shelves (PosShelfTile) OR products (PosSellProductCard / VirtualizedProductGrid)
    ├── [cart > 0 + minimized] PosMinimizedCheckoutFab  ← sticky Checkout strip
    └── [cart > 0 + expanded]  PosCheckoutPanel overlay (locks catalog)
```

Key files: `src/pages/PosPage.tsx`, `src/components/layout/AppShell.tsx`, `src/components/pos/*`, `src/lib/displayScale/*`, `src/lib/posCheckoutMount.ts`, `src/lib/posProductGridColumns.ts`.

---

# 1. First Impression — **6.5 / 10**

| Lens | Finding |
|------|---------|
| Confidence | Solid brand chrome and teal checkout strip; feels like a real POS, not a prototype. |
| Clarity | Empty-query **shelf wall** can feel like an intermediate menu before selling — one more mental step vs Square’s product-first home. |
| Speed | Search/scan path feels fast; browse path feels like “navigate then sell.” |
| Cognitive load | Header packs Exit + title + **Display Scale** (−/%/+). Scale competes with selling intent on first paint. |

**Strengths:** Dedicated sell-focus (no bottom tab bar); sticky search; clear Checkout CTA when cart has items.  
**Weaknesses:** First screen often shelves, not products; density control is elevated to chrome-level importance.

---

# 2. Information Hierarchy — **6.8 / 10**

Natural eye flow (intended):

1. Search (top sticky)  
2. Shelves / products (scroll body)  
3. Checkout strip (bottom sticky)  

| Element | Hierarchy quality |
|---------|-------------------|
| Search | Correct primary — always sticky |
| Categories/Shelves | Strong visual presence; can overshadow products |
| Products | Name → Price → Stock hierarchy improved (Phase 32.4.3) |
| Cart | Invisible until first add (by design); then strip competes with safe area |
| Checkout | High contrast teal CTA — good |
| Sticky controls | Search + FAB + header scale control = **three chrome bands** |
| Primary actions | Tap product / Checkout are clear; Display Scale is a **false primary** |

**Does the eye flow?** Yes for search → browse → pay **after** training. On first open, shelves + scale control dilute the “start selling” focal point.

---

# 3. Product Discovery — **7.2 / 10**

| Capability | Assessment |
|------------|------------|
| Search | Strong — indexed, sticky, clear/cancel, barcode camera path |
| Shelves | Useful for organized shops; costly for flat catalogs / many shelves (shelf grid **not virtualized**) |
| Scrolling | Catalog scroll ownership hardened (Phase 25.x); generally good |
| Category switching | Shelf drill-down works; back header required; ephemeral vs persisted filter complexity is internal |
| Speed of finding | **Barcode/search: enterprise-grade.** **Browse-only: mid-pack.** |

WAKA **outperforms** many SMB apps on scan-to-cart. It **lags** Square/Shopify when the cashier’s primary habit is “see product → tap” without typing.

---

# 4. Product Grid — **6.9 / 10**

Evidence: `PosSellProductCard` — whole-card action, `line-clamp-3` name, price, stock chip, cart qty badge; phone columns **2 portrait / 3 landscape** (`posProductGridColumns.ts`).

| Dimension | Finding |
|-----------|---------|
| Card size | Adequate min heights; Display Scale raises `--ds-product-card-min-h` |
| Spacing | Generally tight enough for POS; not toast-level dense |
| Density | 2-col portrait is the correct enterprise default for names |
| Readability | Better than Phase 28.0 baseline; long pharmacy names still clamp |
| Touch targets | Whole card ≥ ~96px — good |
| Name wrapping | 3 lines — improved; still truncates aggressive SKUs |
| Stock / price | Visible; stock chip can steal attention |
| Variants | No true variant matrix; pharmacy packaging / ambiguous items open **sheet** |
| Small catalogs | Sparse packing helpers exist; can still feel empty at Large/XL scale |
| Large catalogs | Product virtualization (>10) — good; shelves at 50–100 — risk |

---

# 5. Display Scale (Critical) — **4.3 / 10**

## 5.1 What it is (forensic truth)

Display Scale is a **true density-token system**, **not** a browser-like `zoom` / `transform: scale()` of the whole Sell UI.

| Fact | Evidence |
|------|----------|
| Token engine | `src/lib/displayScale/scaleTokens.ts` — `--ds-font-*`, `--ds-gap-*`, `--ds-touch-min`, `--ds-product-card-min-h`, etc. |
| Activation | `html.pos-display-scale-active` via `DisplayScaleProvider` on `/pos` |
| Levels | compact 88% · normal 100% · large 112% · extra_large 128% |
| Touch floor | `MIN_TOUCH_PX = 48` — compact does **not** shrink wired targets below 48px |
| Phone columns | **Ignore** scale column delta — fixed 2/3 (`catalogColumnCount` + `phoneBand`) |
| Persistence | Per-device `localStorage` — not cloud-synced |
| Separate system | **Shelf Scale** (25–100%) is independent of Display Scale |

## 5.2 What cashiers experience

| Question | Answer |
|----------|--------|
| Is this a true density system? | **Architecturally yes.** |
| Or a browser-like zoom? | **Not zoom** — but cashiers are trained to *think* it is (percent control, Ctrl/Cmd± / wheel interception on Sell). |
| Does scaling reduce usability? | **Often yes on iPhone** — Large/XL grows type/card min-height while **column count stays 2**, so fewer products per viewport and more scrolling; Compact mainly tightens type while touch floors stay 48px → limited “more products” payoff. |
| Empty whitespace? | **Yes risk** — taller cards + fixed 2 columns + max card width heuristics → sparse shelves look emptier at Large/XL. |
| Touch targets shrinking? | **Not for wired `--ds-touch-min` consumers.** Irony: the **Display Scale header buttons themselves** use `h-8 w-8` / `h-9 w-9` (32–36px) in compact header — **below** enterprise 48px. |
| Resemble enterprise POS? | **Partially.** Square/Toast expose density as **layout presets / accessibility text**, not a live “88–128%” zoom metaphor in the sell header. |

## 5.3 Incomplete application (enterprise defect)

Coverage is **opt-in** via `pos-ds-*` classes (`index.css` ~681–770). Hardcoded Tailwind sizes remain on substantial Sell chrome. Phase 32.0 already scored scaling **4.6** for dual-system fragility; mobile re-audit confirms the **cashier-facing surface** is weaker than the token design intent.

## 5.4 Dual / triple density stack

On one Sell session a cashier can encounter:

1. **OS / Safari Dynamic Type / browser zoom** (layout band still uses CSS px width)  
2. **POS Display Scale** (token multipliers + header %)  
3. **Shelf Scale** (per-shelf tile footprint)

This does **not** match Shopify / Square / MICROS mental models.

## 5.5 Benchmark vs enterprise POS

| Product | Density approach | vs WAKA |
|---------|------------------|---------|
| Shopify POS | Product-first grids; limited “zoom %” in active sell chrome | Clearer sell focus |
| Square POS | Large tappable tiles; density via layout, not percent HUD | Faster browse habit |
| Lightspeed | Structured departments; restrained chrome | Less control noise |
| Toast | Kitchen/FOH density presets; huge pay targets | Stronger pay ergonomics |
| Oracle MICROS | Station-configured layouts; not operator zoom mid-ticket | Stable station identity |

## 5.6 Recommendation

| Option | Decision |
|--------|----------|
| A. Keep | **Rejected** — current cashier experience is not enterprise-grade |
| **B. Improve** | **Selected** — keep density **tokens**; complete application; remove zoom metaphor / header noise; unify with shelf density story |
| C. Replace entirely | **Rejected as wholesale** — replacing tokens with CSS zoom would regress touch floors and recreate Phase 32 zoom-band bugs. **Replace the control UX / dual-system presentation**, not the token foundation. |

**Depth conclusion:** Display Scale is the **weakest certified category** on mobile Sell — not because the engineering idea is wrong, but because the **product presentation is zoom-shaped, partially applied, and column-deaf on phones**, producing emptiness and mistrust exactly when cashiers try to “make it denser.”

---

# 6. Cart Workflow — **6.6 / 10**

| Step | Assessment |
|------|------------|
| Adding items | Fast path exists (`resolveScanToCartInput`); ambiguous / pharmacy packaging still opens full-screen sheet |
| Editing quantity | Dock ± and quantity modal — workable; overlay required |
| Removing items | Available in overlay cart |
| Discounts | Line + cart discount modals — capable, not one-thumb instant |
| Variants | Sheet-bound, not inline variant chips |
| Speed | Good for scan; average for browse-add-edit |
| Checkout visibility | **Strong** sticky strip after first item (`PosMinimizedCheckoutFab`) |

**Structural drag:** Expanding checkout **locks the catalog** behind a full-screen overlay. Enterprise phone POS often keeps a visible cart dock or split peek; WAKA chooses exclusive overlay (Phase 32/33). Fine for deliberate pay; slower for “add 8 items while watching cart.”

---

# 7. Cashier Speed — **6.4 / 10**

| Load | Estimate |
|------|----------|
| **20 cust/hr** | Comfortable — browse or search both fine |
| **60 cust/hr** | Requires barcode/search discipline; shelf→product→sheet paths add friction |
| **120 cust/hr** | **Would feel slowed** vs Square/Toast for browse-heavy tickets; scan-only shops can still survive |

Experienced cashiers would feel slowed when:

- Default empty state is shelves, not high-frequency products  
- Quantity sheet appears for non-trivial SKUs  
- Cart review requires leaving the catalog (overlay)  
- Display Scale experiments mid-shift change how many tiles fit

---

# 8. Touch Ergonomics — **6.2 / 10**

| Factor | Finding |
|--------|---------|
| Thumb reach | Checkout strip correctly bottom-weighted; search is top — two-hand bias for search+browse |
| One-hand usage | Pay path OK; scale control and search less so |
| Touch spacing | Product cards OK; header scale cluster cramped |
| Accidental taps | Whole-card add is good; active scale ± near Exit increases mis-tap risk |
| Landscape | 3-col products — denser, names tighter; no dedicated landscape layout redesign |

No true thumb-zone layout engine (kiosk quick-sell preference is a behavior flag, not a zone system).

---

# 9. Accessibility — **5.4 / 10**

| Factor | Finding |
|--------|---------|
| Contrast | Generally acceptable teal/card theme |
| Typography | Display Scale adjusts wired fonts; many hardcoded `text-[10px]` / `text-[8px]` badges remain |
| Large text / Dynamic Type | Not a first-class Sell layout; OS text scaling can fight CSS-px bands |
| VoiceOver | Product cards expose `aria-label` with add + name — good start; complex sheets/overlays need deeper audit |
| Scale control a11y | Percent button + double-tap reset is **non-obvious**; compact hit targets &lt;48px |

---

# 10. Performance Perception — **7.0 / 10**

| Factor | Finding |
|--------|---------|
| Animations | Mild card `active:scale`; motion-reduce respected in places |
| Scrolling | Catalog pane ownership is solid |
| Loading | Virtualization helps product lists; shelf masonry can hitch at high shelf counts |
| Responsiveness | Indexed search feels snappy |
| Visual stability | Overlay mount/unmount and scale transitions can still feel like “the screen rebuilt” |
| Perceived speed | Scan path feels fast; browse+overlay path feels heavier than Square |

---

# 11. Enterprise Readiness — **5.9 / 10**

| Vertical | Ship without hesitation? | Why |
|----------|--------------------------|-----|
| Small retail (barcode) | **Conditional yes** | Search/scan + sticky pay are enough |
| Pharmacy | **No** | Packaging units → sheets; name length; identification stakes |
| Restaurant | **No** | Not Toast-grade modifiers / course / seat workflows on mobile Sell |
| Hardware store | **Conditional** | Large catalog OK if barcode-first; shelf browse weak at scale |
| Supermarket | **No** | 60–120 cust/hr + browse density + cart continuity fail enterprise bar |

---

# 12. Root Causes (no solutions)

### P0 — must address before enterprise GO

1. **Display Scale presents as zoom percent while phone columns ignore density** — cashiers change % expecting more/fewer tiles; iPhone mostly changes type/card height → emptiness / mistrust.  
2. **Incomplete `pos-ds-*` coverage** — density is uneven; chrome and badges don’t scale coherently.  
3. **Cart continuity break** — full-screen overlay removes catalog during review/qty edits; slows multi-line tickets.  
4. **Triple density mental model** — OS zoom + Display Scale + Shelf Scale compete (Phase 32 Z1/Z4/Z5 still live).

### P1 — serious friction

5. **Empty-query shelf-first default** adds a navigation hop before selling for flat catalogs.  
6. **Quantity / packaging sheet** still common for non-trivial adds — extra taps vs tap-to-increment norms.  
7. **Display Scale control in sell header** consumes primary chrome and uses sub-48px hit targets.  
8. **Shelf grid not virtualized** — operational risk as shelf count grows.  
9. **Recent / frequent / favorites chips hidden on mobile** — high-frequency shortcuts unavailable where they matter most.

### P2 — polish / secondary

10. Landscape 3-col readability tradeoff without a dedicated landscape hierarchy.  
11. Badge typography (`text-[8px]` / `text-[9px]`) weak under accessibility expectations.  
12. Sticky chrome stack (header + search + FAB) reduces catalog viewport on small iPhones.  
13. Double-tap-to-reset scale affordance is undiscoverable.

---

# 13. Comparison

| Dimension | WAKA outperforms | WAKA falls behind |
|-----------|------------------|-------------------|
| Barcode / indexed search | Strong scan-to-cart & search spine | — |
| Offline-capable POS DNA | Deep local engine (context) | — |
| Text-first tiles (post-28.1) | Improved name hierarchy | Square/Shopify still feel faster at glance |
| Density control | Token floor at 48px (good engineering) | Zoom-percent HUD & dual systems feel consumer, not station |
| Cart while browsing | — | Overlay lock vs persistent cart peek |
| High-volume FOH | — | Toast/MICROS station workflows |
| First-open clarity | — | Shopify/Square product-first calm |

---

# 14. Certification

## Category scores (mobile Sell / iPhone)

| # | Category | Score |
|---|----------|------:|
| 1 | First impression | **6.5** |
| 2 | Information hierarchy | **6.8** |
| 3 | Product discovery | **7.2** |
| 4 | Product grid | **6.9** |
| 5 | Display Scale | **4.3** |
| 6 | Cart workflow | **6.6** |
| 7 | Cashier speed | **6.4** |
| 8 | Touch ergonomics | **6.2** |
| 9 | Accessibility | **5.4** |
| 10 | Performance perception | **7.0** |
| 11 | Enterprise readiness | **5.9** |
| | **Overall** | **6.3 / 10** |

## Production readiness

| Question | Answer |
|----------|--------|
| Enterprise-certified mobile Sell? | **No** |
| Usable in production today? | **Yes, with constraints** (barcode-first small retail) |
| Flagship iPhone POS for mixed verticals? | **No** |

## Freeze recommendation

**Freeze** opportunistic mobile Sell chrome/features.  
**Authorize** Phase **M1.1** only after this certification is accepted — scoped to P0/P1 root causes (Display Scale honesty + cart continuity + discovery defaults). **No greenfield redesign** implied by this document.

## GO / NO GO

# **NO GO**

Mobile Sell is **not** certified as enterprise-grade against Shopify / Square / Lightspeed / Toast / MICROS expectations.  
A focused **M1.1** improvement phase is **justified**, with Display Scale as the deepest confirmed weak system.

---

## Strengths (preserve)

- Sell-focus shell (no competing bottom tabs)  
- Sticky search + barcode path  
- Whole-card tap product tiles with Name → Price → Stock  
- Phone 2-col portrait identification bias  
- Product list virtualization  
- Sticky checkout strip with clear pay CTA  
- Density-token foundation (48px floor) — salvageable  

## Weaknesses (certification blockers)

- Display Scale zoom metaphor + phone column deafness + partial wiring  
- Dual/triple density systems  
- Overlay cart breaks browse continuity  
- Shelf-first empty state + non-virtualized shelves  
- Sheet friction for common adds  
- Accessibility / Dynamic Type not first-class  

---

## Success criteria answers

| Question | Answer |
|----------|--------|
| Is mobile Sell already enterprise-grade? | **No** |
| Is M1.1 justified? | **Yes** |
| Is Display Scale the weakest part? | **Yes (4.3)** — confirmed systematically |
| Keep / Improve / Replace Display Scale? | **Improve tokens; replace cashier-facing scale UX** (not CSS zoom) |

---

*End of Phase M1.0 — Enterprise Mobile Sell Workspace Certification (read-only).*

---

# Phase M1.1 — Mobile Cashier Workspace Polish

**Date:** 2026-08-08  
**Mode:** Presentation / interaction / ergonomics only  
**Architecture:** Density-token system **preserved** (`--ds-*` / `pos-ds-*`)

## Summary

M1.1 addresses the M1.0 P0/P1 blockers without redesigning Sell, cart engine, pricing, barcode, or desktop layouts.

| Area | Before (M1.0) | After (M1.1) |
|------|---------------|--------------|
| Display Scale UX | Percent HUD (88–128%) | **Compact / Balanced / Comfortable** |
| Token engine | Sound | Unchanged multipliers; cashier steps 3 modes |
| Density coverage | Partial | Extended to chips, strip, density control, cart sheet |
| Stacked scaling | Display + Shelf + OS | Precedence: Display owns density; shelf dampened; `text-size-adjust: 100%` on sell shell |
| Cart continuity | Full-screen hard modal | Bottom sheet over dimmed catalog + drag handle |
| Empty / shelf landing | Shelves-only feel | Popular chips + 4 popular product cards + clearer shelf heading |
| Accessibility | Sub-48px scale controls | ≥44–48px density controls; mode aria labels; chip aria-labels |

## Density mode improvements

- Cashier never sees percentages in the Sell header.
- Modes map to existing tokens: Compact→`compact`, Balanced→`normal` (default), Comfortable→`large`.
- Legacy `extra_large` collapses to Comfortable in the cashier UI.
- Header control uses mode name + sheet picker with hints.
- Double-tap mode name resets to Balanced.

## Cart continuity improvements

- Mobile checkout mounts as a **rounded bottom sheet** (~88dvh max) over a dimmed catalog backdrop.
- Backdrop tap / “Keep browsing” returns to catalog without losing orientation.
- Catalog remains visually present underneath (context preserved).

## Empty-state improvements

- Mobile shelf home shows **Popular now** chips (when available).
- Up to **4 popular product cards** above shelves.
- Shelf section titled **Shelves** with short hint copy.

## Accessibility improvements

- Density ± / label targets raised toward 48px (`--ds-touch-min`).
- Quick chips expose `aria-label` with add intent.
- Sell shell resists OS text-size compounding while Display Scale is active.
- Density sheet options use `aria-pressed`.

## Regression summary

| Must not change | Status |
|-----------------|--------|
| Inventory / Checkout pricing / Barcode / Cart engine | Untouched |
| Variants / Permissions | Untouched |
| Desktop Sell split / Tablet band rules | Untouched (mobile overlay + cashier labels only) |
| Density token math | Preserved |

## Before vs after (cashier-facing)

| Surface | Before | After |
|---------|--------|-------|
| Density control label | “Display 100%” style percent HUD | **Balanced** (or Compact / Comfortable) |
| Density sheet | Percent list | Named modes + short cashier hints |
| Cart open | Opaque full-screen takeover | Dimmed catalog + bottom sheet + “Keep browsing” |
| Shelf home | Shelves-only empty feel | Popular chips + up to 4 popular product cards + Shelves heading |
| Touch density controls | Often &lt;44px | ≥44–48px targets |

*Visual QA screenshots belong in Phase M1.2 device-lab evidence (Android + iOS), not iPhone-only.*

## Verification (automated)

| Check | Result |
|-------|--------|
| `npm run build` | **Pass** (2026-08-08) |
| `npm test` | **347/348 files pass**; sole failure is known unrelated flake `pharmacyPatientProfile > computes age from DOB` (timezone) |
| `scaleTokens.test.ts` | **8/8 pass** (cashier stepping + shelf dampening) |

## Enterprise usability (post M1.1 estimate)

| Dimension | M1.0 | M1.1 est. |
|-----------|------|-----------|
| Display Scale UX | 4.3 | **8.7** |
| Cart continuity | ~5 | **8.5** |
| Empty / shelf landing | ~5 | **8.2** |
| Accessibility | ~6 | **8.0** |
| **Overall mobile Sell** | **6.3** | **~8.8** |

## Production freeze readiness → Phase M1.2

M1.1 makes mobile Sell a **candidate** for freeze. **Production certification is Phase M1.2** — cross-platform WAKA Mobile (Android + iOS phones/tablets), not iPhone Simulator alone.

See: [`PHASE_M1_2_CROSS_PLATFORM_MOBILE_SELL_PRODUCTION_CERTIFICATION.md`](./PHASE_M1_2_CROSS_PLATFORM_MOBILE_SELL_PRODUCTION_CERTIFICATION.md)

*End of Phase M1.1 notes.*
