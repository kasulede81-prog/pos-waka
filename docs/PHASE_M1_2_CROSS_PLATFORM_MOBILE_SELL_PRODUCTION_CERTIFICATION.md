# Phase M1.2 — Cross-Platform Mobile Sell Production Certification

**Also titled:** Enterprise Mobile Sell Production Certification (Android + iOS)  
**Date opened:** 2026-08-08  
**Mode:** Production certification (device lab + automated gates)  
**Prerequisite:** Phase M1.0 (audit) + Phase M1.1 (cashier polish)  
**Product framing:** **WAKA Mobile** — not “WAKA iPhone”

---

## Purpose

Certify the Sell workspace for production across the **mobile platform**: Android phones (primary market, especially Uganda), iPhones, Android tablets, and iPads (where supported).

The iOS Simulator and a single Android emulator are **test environments**, not the certification target.

When this phase is complete, the certified statement is:

> **The WAKA Mobile Sell workspace is certified for production on Android and iOS. The experience is consistent across supported screen sizes, respects platform conventions where appropriate, and maintains enterprise usability, performance, and reliability.**

Platform-specific behaviors (native navigation, permissions, printing, scanner stacks) are allowed when they improve the cashier experience; they must not create a second product.

---

## Certification principles

| Principle | Meaning |
|-----------|---------|
| Platform over device | Do not certify against one phone model |
| Android-first evidence | Prioritize mid-range Android common in Uganda (Samsung A, Tecno, Infinix, Xiaomi) |
| Layout bands, not brands | Phone ≤767 CSS px; tablet 768–1023; desktop ≥1024 — certify each band on both OSes |
| Density is cashier language | Compact / Balanced / Comfortable on every phone class |
| Consistency with local conventions | Material/system back, permissions, share sheets, print bridges may differ by OS |
| Evidence required | Pass/fail rows need device class, OS version, build ID, and notes |

---

## Status

| Gate | Status |
|------|--------|
| M1.1 polish landed | ✅ Complete |
| Automated `npm run build` / `npm test` | ✅ Baseline green (see M1.1; re-run at sign-off) |
| Android phone matrix | ⬜ Not yet executed |
| iPhone matrix | ⬜ Not yet executed |
| Tablet matrix | ⬜ Not yet executed |
| Feature / device / performance matrices | ⬜ Not yet executed |
| **Production certification verdict** | ⬜ **OPEN** |

---

## Certification matrix

### Android phones (primary)

Representative classes (not an exclusive SKU list):

| Class | Examples | Priority |
|-------|----------|----------|
| Entry / mid | Samsung A series, Tecno, Infinix, Xiaomi Redmi | **P0** (Uganda volume) |
| Upper mid / flagship | Samsung S series, Google Pixel | P1 |
| Large phablet | 6.8"+ / 7"+ foldable outer | P1 |

**Viewport bands to hit:**

| Band | Approx. CSS width | Must pass |
|------|-------------------|-----------|
| Compact phone | ~320–360 (e.g. small / zoomed) | Density + cart sheet + pay strip |
| Standard | ~360–400 (~6.1") | Full Sell path |
| Large | ~400–430 (~6.5–6.8") | Full Sell path |
| XL / 7"+ | ≥430 where still phone band | No layout breakage |

### iPhone

| Class | Must pass |
|-------|-----------|
| SE (small) | Density modes, cart sheet, safe areas |
| Standard | Full Sell path |
| Pro | Full Sell path |
| Pro Max | Full Sell path + thumb reach |

### Tablets

| Platform | Examples | Band expectation |
|----------|----------|------------------|
| Android | Lenovo Tab, Samsung Tab | Tablet layout (not phone overlay cart if tablet band) |
| Apple | iPad 11", iPad 13" | Tablet / desktop-adjacent Sell where supported |

Tablet certification confirms **correct layout band**, not that phone UI is forced onto iPad.

---

## Feature matrix (all certified phone classes)

### Sell density

| Check | Compact | Balanced | Comfortable |
|-------|---------|----------|-------------|
| Labels (no %) | ☐ | ☐ | ☐ |
| Touch targets ≥44–48px | ☐ | ☐ | ☐ |
| No stacked “fake zoom” | ☐ | ☐ | ☐ |
| Product discovery unchanged | ☐ | ☐ | ☐ |

### Cart & checkout

| Check | Android phone | iPhone | Notes |
|-------|---------------|--------|-------|
| Add / remove lines | ☐ | ☐ | |
| Discounts | ☐ | ☐ | |
| Variants | ☐ | ☐ | |
| Checkout complete sale | ☐ | ☐ | |
| Sheet continuity (browse under cart) | ☐ | ☐ | M1.1 |

### Barcode

| Path | Android | iOS | Notes |
|------|---------|-----|-------|
| Camera scan | ☐ | ☐ | Permissions |
| Bluetooth scanner | ☐ | ☐ | Where hardware available |
| USB / HID keyboard wedge | ☐ | ☐ | Especially Android + desktop-docked |

### Receipt

| Path | Android | iOS |
|------|---------|-----|
| Print (platform bridge) | ☐ | ☐ |
| PDF | ☐ | ☐ |
| Share sheet | ☐ | ☐ |

### Orientation

| Check | Phone | Tablet |
|-------|-------|--------|
| Portrait | ☐ | ☐ |
| Landscape (where supported) | ☐ | ☐ |
| Rotation without cart/data loss | ☐ | ☐ |

### Device & session resilience

| Check | Android | iOS |
|-------|---------|-----|
| Camera permission deny/retry | ☐ | ☐ |
| Soft keyboard / search focus | ☐ | ☐ |
| Bluetooth connect/disconnect mid-shift | ☐ | ☐ |
| Offline sell | ☐ | ☐ |
| Poor network | ☐ | ☐ |
| Airplane mode | ☐ | ☐ |
| Background → foreground | ☐ | ☐ |
| App kill / restart (draft preserved per product rules) | ☐ | ☐ |

---

## Performance matrix

Measure on **lower-end Android** and at least one newer flagship (either OS).

| Scenario | Entry Android | Flagship | Pass criteria (guidance) |
|----------|---------------|----------|---------------------------|
| Catalog ~1,000 products | ☐ | ☐ | Smooth browse; search usable |
| Catalog ~10,000 products | ☐ | ☐ | Virtualized list remains responsive |
| Large cart (many lines) | ☐ | ☐ | Sheet scroll + totals stable |
| Long session (hours) | ☐ | ☐ | No progressive jank / obvious leak |
| Memory pressure | ☐ | ☐ | No crash on catalog ↔ cart cycles |
| Smooth scrolling | ☐ | ☐ | Shelf + product grids |
| Cold startup to Sell | ☐ | ☐ | Record p50/p95; no regression vs prior build |

Exact numeric SLOs may be filled from existing performance certification baselines when the lab runs.

---

## Automated gates (every sign-off build)

```bash
npm run build
npm test
```

Re-record results in the sign-off table below. Known unrelated flakes must be named (do not hide failures).

---

## Sign-off table (fill at close)

| Field | Value |
|-------|-------|
| Build / version | |
| Android evidence (devices + OS) | |
| iOS evidence (devices + OS) | |
| Tablet evidence | |
| P0 defects open | |
| Performance notes | |
| **Verdict** | ☐ Certified · ☐ Conditional · ☐ Not certified |
| Certified statement | *(use Purpose statement when fully certified)* |

---

## Out of scope

- Redesigning Sell or replacing density tokens  
- Changing cart engine, pricing, barcode decode rules, inventory, or permissions  
- Desktop Sell redesign (≥1024) — regression only  
- Certifying a single OEM skin as the product

---

## Relationship to prior phases

| Phase | Role |
|-------|------|
| M1.0 | Read-only audit — mobile Sell **6.3/10**, Display Scale weakest |
| M1.1 | Cashier polish — density modes, cart continuity, landing, a11y (~8.8 est.) |
| **M1.2** | **Cross-platform production certification** — Android + iOS evidence |

---

## Closing rule

M1.2 is **not complete** until Android phone evidence (P0 classes) and iPhone evidence both exist for Sell density, cart/checkout, and offline/poor-network paths. Simulator-only or iPhone-only results are **insufficient** for production certification of WAKA Mobile.
