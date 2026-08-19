# VL-2.1-R2 — Final Typography Device Sign-Off

**Date:** 2026-08-19  
**Mode:** FINAL VERIFICATION ONLY — no CSS, sizes, spacing, truncation, Home order, POS, or checkout changes.  
**Baseline:** VL-1 weights · VL-2.1 hierarchy · `docs/VL_2_1_R1_VISUAL_VERIFICATION.md`

---

## Verdict

**CONDITIONAL GO**

Code, tests, and R1 still say VL-2.1 is layout-safe. **This session did not visually confirm Home, Settings Home Menu, or Sell on a real 390×844 phone, 1280×720 desktop, or Electron 1440×900.**

A device sign-off that claims **GO** would be false. Residual R1 items (long greeting names, Luganda subscription banner wrap) remain **unobserved in pixels**.

**Do not treat R2 as closed GO.** An operator (or a follow-up with a logged-in session) must tick the device checklist below. Until then, VL-2.2 is optional and still should not touch POS.

No issues were *found* on device, because those screens were **not rendered here**. Nothing was fixed (audit-only).

---

## Devices tested

| Target | Tested this session? | Result |
|---|---|---|
| Mobile 390×844 | **No** | Not opened; no authenticated Home capture |
| Desktop 1280×720 | **No** | Not opened |
| Electron 1440×900 | **No** | Packaged app not launched |
| Android emulator (existing `docs/waka-emulator-*.png`) | **Not VL-2.1 Home** | Login chrome only; cannot sign off Home tiles / liveStat |
| English Home | **No** | — |
| Luganda Home | **No** | — |

Vite `npm run dev` was running; that is **not** a viewport screenshot of `/` after login.

---

## Screens tested

| Screen | 390 | 1280×720 | Electron 1440 | Evidence |
|---|---|---|---|---|
| Home greeting | Not captured | Not captured | Not captured | Code: `font-bold` 18/20px, no truncate |
| Sell hero | Not captured | Not captured | Not captured | File not in VL-2.1; CTA still `font-bold` + primary + 48px |
| First Primary tile | Not captured | Not captured | Not captured | Title `font-bold` + **truncate**; liveStat `font-black` |
| Reports card | Not captured | Not captured | Not captured | 88px min; KPI `MonoNumber`; affordance `font-bold` |
| KPI / Health | Not captured | Not captured | Not captured | VL-2.1 did not edit these files; packing tokens unchanged |
| Settings Home Menu | Not captured | Not captured | Not captured | Labels 700; color **buttons** still `font-black` |
| POS Sell / checkout | Not captured (and **must stay unchanged**) | — | — | Source still `font-black` on names, prices, payable, pay, keypad |

---

## Findings

### Confirmed again from source (not pixels)

| Check | Status |
|---|---|
| Greeting 700 | Yes — `DesktopHomePage` `font-bold` |
| Tile title 700 | Yes — enterprise `LivingDashboardCard` title `font-bold` |
| Subtitle 500 | Yes — `font-medium` |
| LiveStat stronger | Yes — still `font-black tabular-nums` |
| Financial / POS | Unchanged `font-black` on product cards, cart, totals |
| min-heights 112 / 96 / 88 | Unchanged |
| `max-w-7xl` Home measure | Unchanged |
| HOME-DENSITY-1.2 order | Unchanged by VL-2.1 |
| Truncation | Tile titles still `truncate`; greeting still **not** truncated |

### Device findings

**None.** No wrap, clip, ellipsis, taller cards, first-screen, or CTA regressions can be asserted or denied from pixels in this session.

### Pre-existing screenshots (not R2 evidence)

`docs/waka-emulator-app.png` (and related emulator PNGs) show the **login** card, not Home after VL-2.1. They do not certify tile titles vs liveStat.

---

## Screenshots/evidence

| Item | Status |
|---|---|
| 390×844 Home EN | **Not attached** |
| 390×844 Home LG | **Not attached** |
| 390 Settings Home Menu | **Not attached** |
| 1280×720 first screen | **Not attached** |
| Electron 1440×900 | **Not attached** |
| R1 forensic | `docs/VL_2_1_R1_VISUAL_VERIFICATION.md` |
| VL-2.1 class list | `docs/VL_2_1_WEIGHT_HIERARCHY_REFINEMENT.md` |

This agent has no authenticated browser/device session to Home. Inventing captures would invalidate sign-off.

---

## Remaining risks

Same as R1, still open:

1. Long greeting `{name}` on 390 (center, no truncate).  
2. Luganda subscription headline (banner has no truncate). Greeting LG keys are still English in `i18n.ts` — LG tile titles (`Emirimu egy'enjawulo`, `Embeera y'ensimbi`) **truncate**, so height should hold.  
3. Android/iOS/Electron rasterization of real 700 vs former synthetic 900.  
4. Taste: titles may feel “lighter” without being a density bug.

---

## Operator checklist (to convert this to GO)

Run logged-in Home. **Do not change code.** Tick:

- [ ] 390×844 EN: greeting one line (or acceptable wrap); Sell CTA still loud; first Primary title not clipped wrongly; Reports 88px-class height; Primary still on first screen per 1.2  
- [ ] 390×844 LG: long tile titles ellipsis, not extra card rows  
- [ ] Settings → Home Menu: preview titles 700; controls usable; color picker selection still ring  
- [ ] 1280×720: `max-w-7xl` measure; KPI/Health **not** packed (pack is 1024–1279 only); Primary after Health; Reports after Primary  
- [ ] Electron 1440×900 if available: titles calmer than liveStat; no new empty chrome  
- [ ] Spot Sell: product name/price still heavy; pay button unchanged  

If any box fails: **NO-GO** for further VL-2.x; report the screen; do not “fix” with padding or font-size.

If all boxes pass: replace this verdict with **GO** in a short addendum (still no source changes required).

---

## Sign-off boundary

| Allowed next | Not allowed until GO |
|---|---|
| Operator device glance | Claiming pixel GO from this file alone |
| VL-2.2 Settings/forms **after** glance | Repo-wide `font-black` replace |
| | POS / checkout / keypad / receipts weight changes |
