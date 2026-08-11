# Phase M1.4-R1 — Mobile Sell Shelf Secondary Visual Certification

**Date:** 2026-08-11  
**Mode:** READ-ONLY visual / forensic audit (no source code modified)  
**Production target:** WAKA Mobile — Android + iOS  
**Prerequisites:** M1.1-R5 · M1.3 · M1.3-R1 · M1.4  

---

## Executive verdict

### **CONDITIONAL GO**

**Decision: A** — M1.4 is architecturally / presentation-complete for the shelf secondary polish.  
Do **not** open an M1.5 Sell-shelf implementation phase. Proceed to **M1.2** for whole-experience cross-platform certification (which includes the remaining on-device Sell matrix).

M1.4 **closed** every M1.3-R1 hierarchy finding in code:

| M1.3-R1 ID | Severity | Status after M1.4 |
|------------|----------|-------------------|
| SH-1 Popular full cards | P1 | **CLOSED** — compact horizontal rail |
| SH-2 4-product sparse | P2 | **CLOSED** — tiny end cue for 4–6 |
| SH-3 Redundant Back | P2 | **CLOSED** — Back only when no secondary rails |
| SH-4 Heavy header | P3 | **CLOSED** — phone `compact` ≥44px |
| SH-5 Busy secondary stack | P3 | **CLOSED** — both sections are rails |

Checkout / POS engines were **not** touched by M1.4.

**Why not full production GO:** This session could not complete the live Sell 1→50+ product visual matrix on Simulator (booted app was on Back Office Danger Zone, not Sell shelf drill-down). Forensic evidence is strong; Android + multi-size phone lab remains part of **M1.2**, not another shelf redesign.

---

## M1.3-R1 findings → M1.4 changes

| Finding | M1.4 change | Forensic confirmation |
|---------|-------------|----------------------|
| SH-1 | Popular → `pos-ds-quick-chip` rail, name + price, `min-h-[44px]`, max 6 | ✅ No `PosSellProductCard` in `PosMobileShelfContinue` |
| SH-2 | `PosMobileShelfEndCue` for counts 4–6 | ✅ `shouldShowMobileShelfEndCue`; no rails, no illustration |
| SH-3 | Full `posBackToShelves` only when `!hasPopular && !hasOtherShelves` | ✅ Explicit gate in continue component |
| SH-4 | `PosShelfDrillDownHeader` `compact={mobileSellFocus}` | ✅ 44px back, reduced padding |
| SH-5 | Popular + Other Shelves both horizontal rails | ✅ Vertical weight demoted vs open-shelf cards |

---

## Visual assessment (forensic hierarchy)

Intended structure in code:

```text
← Shelves          [Shelf] / N products     ← compact header
★ Open-shelf PosSellProductCard grid        ← HERO (unchanged cards)
── border ──
Popular now        [chip][chip]… →          ← SECONDARY rail
Other shelves      [chip][chip]… →          ← SECONDARY rail
(or End of shelf + Back when neither rail)
```

### Hierarchy weight (code)

| Layer | Rendering | Weight |
|-------|-----------|--------|
| Open shelf products | Full `PosSellProductCard` grid | ★★★★★ hero |
| Popular | Compact 2-line chips, max-w ~10.5rem, horizontal scroll | ★★ secondary |
| Other Shelves | Compact chips, horizontal scroll | ★ secondary |
| End cue (4–6) | Single text row + text button | ★ minimal |
| Fallback Back (≤3, no rails) | One full-width button | ★★ intentional end |

Popular **cannot** render a full-card wall anymore — the previous P1 inversion path is removed.

---

## Test matrix (forensic)

| Count | Continuation | Expected hierarchy |
|------:|--------------|--------------------|
| 1–3 | `PosMobileShelfContinue` if mobile drill-down | Products hero; rails secondary; Back only if both rails empty |
| 4–6 | `PosMobileShelfEndCue` only | Products hero; tiny end cue; **no** Popular/Other rails |
| 7–9 | None | Product grid only |
| 10+ | None + virtualization (`VIRTUAL_PRODUCT_THRESHOLD = 10`) | Unchanged large-catalog path |
| 50+ | Same | No secondary datasets attached |

| Case | Forensic result |
|------|-----------------|
| 1 product | Card not stretched; natural pane; Popular chips ≪ product card height budget |
| 2–3 products | Grid remains primary; rails add ~1–2 short rows each, not another card grid |
| 4–6 | End cue is border + 11px label + 44px text control — not a card / not empty-state art |
| 7+ | No continue / no end cue — correct |
| Empty Popular | Section omitted (`hasPopular` false) |
| Empty Other Shelves | Section omitted |
| Neither rail | Compact End of shelf + Back — deliberate, not a giant void |

**Live Simulator matrix:** OPEN for human walk-through on Sell (1,2,3,4,5,6,7,10,50+) × Compact/Balanced/Comfortable. Not blocking Decision A (no further shelf code phase).

---

## Popular Today

| Check | Result |
|-------|--------|
| Horizontal rail | ✅ |
| Max items | ✅ `MOBILE_SHORT_SHELF_POPULAR_MAX = 6` |
| Data | ✅ `soldTodayByProduct` qty > 0 only |
| Excludes open shelf | ✅ `!productMatchesCategoryFilter(p, sellCategoryKey)` |
| Name + price | ✅ truncated name + `formatProductPriceLabel` |
| Touch ≥44px | ✅ `min-h-[44px]` |
| Full product-card grid | ❌ removed |
| Fake popularity / stats / images | ❌ none |
| Hidden when empty | ✅ |

---

## Other Shelves

| Check | Result |
|-------|--------|
| Horizontal compact rail | ✅ |
| Max 6 | ✅ |
| Current shelf excluded | ✅ |
| count > 0 only | ✅ |
| ≥44px | ✅ |
| Navigation | ✅ `onShelfTap` → `handleCatalogShelfTap` |
| Large cards | ❌ none |

---

## Back navigation & header

| Check | Result |
|-------|--------|
| Header ← Shelves always present in drill-down | ✅ |
| Duplicate full Back when Popular or Other Shelves exists | ❌ gated off |
| Fallback Back when no rails | ✅ useful end action |
| Compact header ≥44px | ✅ |
| Readable title + count | ✅ |
| Not redesigned | ✅ presentation tighten only |

---

## Density

| Check | Result |
|-------|--------|
| Compact / Balanced / Comfortable | ✅ unchanged token path |
| Phone Comfortable card cap 108px | ✅ `min(var(--ds-product-card-min-h), 108px)` |
| Secondary rails do not use product-card min-height | ✅ chips use quick-chip / inline flex |
| CSS zoom | ❌ not introduced |
| `--ds-*` / `pos-ds-*` | ✅ intact |

---

## Android / iOS assessment

| Platform | Assessment |
|----------|------------|
| Architecture | ✅ Shared React + CSS; no platform UI branch in M1.4 |
| iOS Simulator | App was running (iPhone 17) but **not** on Sell shelf during capture — cannot claim iOS visual GO from this session |
| Android | First-class target; **lab OPEN** under M1.2 (small / normal / large) |
| Conclusion | Implementation is cross-platform-ready; device visual GO deferred to M1.2 |

---

## Regression assessment

### M1.4 git surface (presentation only)

```text
src/components/pos/PosMobileShelfContinue.tsx
src/components/pos/PosShelfDrillDownHeader.tsx
src/lib/posMobileShortShelf.ts
src/lib/posMobileShortShelf.test.ts
src/pages/PosPage.tsx   (wiring only: compact header, continue/end-cue gates)
```

### Untouched (verified)

| Area | Evidence |
|------|----------|
| `PosCheckoutPanel.tsx` | Diff size **0** vs HEAD |
| `posMobileCheckoutBudget.ts` / cart sheet items | Diff size **0** |
| Checkout workspace | Still `pos-mobile-checkout-workspace` + `100dvh` in `index.css` / `PosPage` |
| Keypad / Complete Sale / cart engine / pricing / payment / inventory / barcode / receipt / Cash Drawer / Vision / Back Office | Not in M1.4 file set |

### M1.1-R5 still authoritative

- Full-screen `100dvh` workspace  
- Cart-only scrolling zones in checkout panel (unchanged)  
- Pinned totals / payment / keypad / Complete Sale architecture preserved  

### Automated verification

| Check | Result |
|-------|--------|
| `posMobileShortShelf.test.ts` | 4/4 pass |
| Checkout files in M1.4 diff | None |

---

## Scoring

| Dimension | Score | Notes |
|-----------|------:|-------|
| Shelf hierarchy | **9.0** | Hero/secondary inverted hierarchy path removed |
| Product card presentation | **8.5** | Unchanged hero cards; phone Comfortable capped |
| Whitespace | **8.5** | Natural pane + rails / end cue; no flex void return |
| Popular rail | **9.0** | Compact, real data, capped |
| Other Shelves rail | **9.0** | Same quality as M1.3, still compact |
| Navigation | **9.0** | Redundant Back removed |
| Density modes | **8.5** | Architecture preserved |
| Small-phone usability | **8.5** | Forensic; lab OPEN |
| Android readiness | **8.0** | Shared path; device lab in M1.2 |
| iOS readiness | **8.0** | Shared path; Sell matrix lab OPEN |
| **Overall** | **8.6 / 10** | |

vs M1.3-R1 overall **7.6** — +1.0 from hierarchy demotion of Popular and navigation cleanup.

---

## Remaining issues

| ID | Sev | Issue | Action |
|----|-----|-------|--------|
| VR-1 | P3 | Live Sell 1→50+ × density matrix not captured on device this session | Cover in **M1.2** visual lab |
| VR-2 | P3 | Android physical / emulator sizes not re-walked here | Cover in **M1.2** |

No P0 / P1 / P2 open from M1.3-R1.  
No invented polish items. **No M1.5 shelf phase recommended.**

---

## Final recommendation

| Choice | Selected |
|--------|----------|
| A — Visually complete enough; proceed to M1.2 | **YES** |
| B — Needs another small polish phase | No |
| C — Significant regression / repair | No |

### Final verdict: **CONDITIONAL GO**

Conditions for treating shelf secondary polish as **done**:

1. Stop further Sell-shelf presentation churn (Decision A).  
2. Run **M1.2 Cross-Platform Mobile Sell Production Certification**, including explicit Sell shelf cases (1–6, 7, 10, 50+) on Android + iOS and Compact/Balanced/Comfortable.  
3. Confirm checkout still behaves as M1.1-R5 during that lab.

Promote to production **GO** for the shelf secondary work only after M1.2 records the Sell visual matrix as pass — not from automated tests alone.

---

*End of Phase M1.4-R1 — read-only certification. No source code was modified.*

---

### Phase M1.4-R2 — Final Short-Shelf Composition Repair

**Date:** 2026-08-11  
**Mode:** Scoped presentation-only implementation  
**Checkout:** Untouched (M1.1-R5)

#### Original visual problem (video)

M1.4 rails were correct, but 1–2 product shelves (e.g. Antibiotics ×2, Bakery ×1) still showed a large empty lower viewport after Other Shelves — technically not a flex void, but user-visible “dead screen.”

#### Chosen composition

1. Short shelves (1–3) use `pos-catalog-scroll-pane--short-finish` — column fills remaining catalog height.  
2. Product grid stays `shrink-0` (normal card size; not stretched).  
3. M1.4 Popular / Other Shelves rails stay compact at the top of the continue block.  
4. Remaining height owned by `pos-mobile-shelf-end-finish`: soft muted gradient + “End of shelf” + compact **Explore another shelf →** (or Back when no rails).  
5. No fake products, no giant cards, no illustrations.

#### Behavior by count

| Count | Behavior |
|------:|----------|
| 1–3 | Short-finish pane + rails + deliberate end zone |
| 4–6 | Unchanged tiny `PosMobileShelfEndCue` on natural pane |
| 7+ | Unchanged natural pane; no secondary rails |
| 10+ | Virtualization unchanged |

#### Density / architecture

- Compact / Balanced / Comfortable preserved  
- Phone Comfortable 108px card cap preserved  
- No CSS zoom; `--ds-*` / `pos-ds-*` untouched  
- Shared Android + iOS React/CSS path  

#### Regression

| Check | Result |
|-------|--------|
| `PosCheckoutPanel.tsx` | Zero diff |
| Checkout 100dvh workspace | Intact |
| M1.4 rails | Preserved |
| Cart / pricing / payment / inventory / barcode | Untouched |

#### Manual QA (required for GO)

Walk Sell shelves: 1, 2, 3, 4, 6, 7, 10+, 50+ × Compact/Balanced/Comfortable.  
Especially Antibiotics-like (2) and Bakery-like (1): ask “Does this still look like a large empty screen?” — must be **No**.

#### M1.4-R2 verdict

**CONDITIONAL GO** pending Simulator / device visual confirmation that the end zone removes the dead lower region without overpowering open-shelf products.

*End of Phase M1.4-R2 notes.*
