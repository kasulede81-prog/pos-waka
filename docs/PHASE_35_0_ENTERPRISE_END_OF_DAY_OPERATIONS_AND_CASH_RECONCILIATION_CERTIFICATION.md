# Phase 35.0 — Enterprise End-of-Day Operations, Shift Closing & Cash Reconciliation Certification

**Mode:** Read-only enterprise audit (**NO code changes, NO CSS, NO API, NO database changes**)  
**Date:** 2026-08-04  
**Scope:** Complete business closing workflow — open drawer → shift → sales → cash movements → shift close → day close → reports → audit  
**Out of scope:** Sell product-grid UX (Phases 32–33), Home dashboard (Phase 34), inventory engines  
**Related prior work:**  
- Phase 21.3 — production stability (stale shifts, force-close)  
- Phase 21.6 — shift recovery & cash drawer reliability  
- Phase 21.8 — drawer tolerance & cash variance UX  
- `CASH_EXPENSES_FEATURE_SPEC.md`  

**Core question:**

> Can a multi-cashier retail / pharmacy / hospitality shop open, operate, reconcile cash, and close the day with enterprise-grade accountability?

---

## Executive Summary

WAKA’s end-of-day stack is a **mature cash-first operational system** (formula **v2** day-owned float), not a thin “close register” button. It includes:

- Day drawer open with authoritative opening float  
- Shift start with float verification (+ manager override)  
- Cash in/out adjustments, expenses, handoff float  
- Shift close with expected vs counted + variance UX  
- Day close with **preflight hard stops**, variance PIN, sync override, emergency close, reopen  
- Extensive `AuditAction` coverage and recovery wizards  

It is **strong for Uganda-style cash-primary retail** and already ahead of many SMB POS products on shift recovery and day-close enforcement.

It is **not fully certified as multi-tender enterprise POS** because physical reconciliation counts **cash only**. Card/ATM, mobile money, credit, and bank appear as **report breakdowns**, not as counted closing tenders. There is also **no single guided End-of-Day wizard** — operators navigate Day Open → Cash Position → Shift Close → Close Day → X/Close reports across routes.

| Persona fitness | Verdict |
|-----------------|---------|
| Retail / hardware / supermarket (cash-heavy) | **Strong** |
| Pharmacy (shared till + dispense) | **Strong** (same gateway; no separate till model) |
| Restaurant / hospitality | **Good** (table blockers; same cash math) |
| Multi-cashier with handoff | **Good** (v2 handoff float) |
| Card + MoMo heavy multi-tender close | **Weak** (analytics only) |

**Overall certification status: CONDITIONALLY CERTIFIED for cash-primary operations; NOT CERTIFIED for full multi-tender enterprise reconciliation.**

**Freeze recommendation:** Do **not** freeze EOD as complete. Phase 35.1 should focus on **workflow consolidation + multi-tender closing accountability** (presentation/orchestration where possible; new tender-count math only if product explicitly scopes it). Leave core v2 ledger formulas alone unless a P0 integrity defect is found.

---

## Score Table

| Category | Score | Verdict |
|----------|------:|---------|
| Opening Workflow | **8.1** | Clear v2 baseline |
| Cashier Session | **7.6** | Accountable shifts + recovery |
| Sales Accountability | **7.8** | Traceable financial events |
| Cash Drawer | **8.2** | Rich movements + expenses |
| Reconciliation | **6.2** | Cash count strong; multi-tender weak |
| Closing Workflow | **8.0** | Preflight + PIN + reopen |
| Reports | **7.1** | Close Day / X / shift exports; no formal Z |
| Audit Trail | **8.5** | Broad action coverage |
| Desktop | **6.4** | Responsive office pages; not a dedicated EOD desk |
| Mobile | **7.4** | Modal/sheet cashier flows fit phone |
| Accessibility | **6.0** | Usable; PIN/preflight density varies |
| **Overall** | **7.4 / 10** | Cash-primary enterprise; multi-tender gap |

---

## Certification Methodology

1. Static forensics of day open, shift open/close, cash ledger, day close, preflight, approvals.  
2. Type/store/DB/sync inventory (`DayDrawerOpen`, `ShiftRecord`, `DayCloseSummary`, adjustments, expenses).  
3. Permission matrix (`day.open_drawer`, `day.close`, `shift.*`, expenses).  
4. Vertical differences (hospitality blockers, pharmacy reuse).  
5. Prior Phase 21.x certifications (not re-litigated as substitutes).  
6. Enterprise POS workflow benchmarks (accountability only — no layout cloning).

**Not performed:** Live timed close lab; multi-device conflict soak; printer failure field test.

---

## Workflow Map (current implementation)

```
OWNER/MANAGER (once per day)
  DayOpenPage (/office/day-open)
    → recordDayDrawerOpen(openingFloat)
         │
CASHIER / WAITER (per session)
  ShiftSellGateway → ShiftOpeningScreen
    → beginShiftV2(verifiedFloat [, managerPin on mismatch])
         │
  DURING SHIFT
    Sales / discounts / refunds / voids / pending sales
    CashPosition / CashManagement adjustments (day.close)
    Cash expenses (expenses.*)
    X Report (mid-day, does not close)
         │
  SHIFT CLOSE
    ShiftCloseModal → closeShiftWithCashCount / handoffFloat
    (variance UX informational — Phase 21.8)
    Recovery: ShiftRecoveryWizard / force-close
         │
MANAGER/OWNER (end of day)
  CloseDayPage (/close-day)
    → preflight (open shifts, hospitality, pending sales, sync, sequential days, cash counted…)
    → expected vs counted → variance classify → manager PIN if flagged
    → recordDayClose (+ PDF) / emergency / reopen
```

| Route | Permission | Purpose |
|-------|------------|---------|
| `/office/day-open` | `day.open_drawer` | Open business day float |
| Sell / Dispense | `shift.start` | Verify float & sell |
| `/office/cash-position` | `day.close` | Movements + position |
| `/office/cash-drawer` | `day.close` | Cash management hub |
| `/cash-expenses` | `expenses.record` | Drawer expenses |
| `/office/x-report` | `reports.view` | Mid-day X |
| `/office/open-shifts` | `back_office.access` | Shift list / recovery |
| `/close-day` | `day.close` | Business day close |

---

# PART 1 — Opening Workflow

| Step | Status | Evidence |
|------|--------|----------|
| Open drawer (business) | Yes | `DayOpenPage` → `recordDayDrawerOpen` |
| Starting cash | Yes | `DayDrawerOpen.openingFloatUgx` (v2 authoritative) |
| Shift initialization | Yes | `beginShiftV2` requires active day open |
| Opening confirmation | Yes | Float verify UI; mismatch → `FloatVerifyOverrideModal` |
| Cashier identification | Yes | Shift bound to session actor |
| Hardware kick | Separate | `cashDrawerAdapter` / `openCashDrawerManual` — **not** day open |

**Baseline quality:** Strong under formula v2 (default). Legacy v1 shift-owned float still exists for migration but is secondary.

**Opening Workflow: 8.1 / 10**

---

# PART 2 — Cashier Session

| Concern | Finding |
|---------|---------|
| Cashier identity | `ShiftRecord.actorUserId` / actor name on preflight rows |
| Session persistence | Shifts in preferences + cloud sync (`shiftCloudSync`) |
| Device ownership | Device label on open-shift preflight rows |
| Active shift visibility | `ActiveShiftBanner`, `PosShiftSummaryCollapsible`, Open Shifts page |
| Multiple users | Handoff float (v2); recovery for other operators |
| Role awareness | Cashier: `shift.start/close` only; cannot day-open or day-close |

**Accountability:** Clear separation — cashiers run shifts; managers own the day.

**Cashier Session: 7.6 / 10**

---

# PART 3 — Sales During Shift

| Event | Traceable? | Notes |
|-------|------------|-------|
| Sales | Yes | Shift totals; reporting day key |
| Discounts | Yes | Line/cart discounts on sales; day/shift summaries |
| Refunds / returns | Yes | Return records; cash refunds affect expected drawer |
| Voids | Yes | `sale_void` audit / sale lifecycle |
| Suspended / pending | Yes | `pending_sales.manage`; **blocks day close** if open |
| Draft cart | Ephemeral | Must finalize or park before close gates |

**Sales Accountability: 7.8 / 10**

---

# PART 4 — Cash Drawer Management

| Movement | Type / path |
|----------|-------------|
| Cash added | `cash_added`, `owner_injection`, `float_replenishment`, `safe_transfer_in` |
| Cash removed | `cash_removed`, `owner_withdrawal`, `bank_deposit`, `safe_transfer_out` |
| Float | Opening float + verify + handoff |
| Safe drop | **No `safeDrop` name** — use `safe_transfer_out` / `bank_deposit` |
| Expenses | `CashExpense` with approve/reject/void |
| Unexpected movement | Adjustments require `day.close`; audited |

Ledger: `cashDrawerLedger.computeExpectedDrawerCashV2` + `cashReconciliation.getDrawerCashForDayInput`.

**Cash Drawer: 8.2 / 10** — discoverability of “safe drop” language is a UX gap, not a ledger gap.

---

# PART 5 — End-of-Day Closing

Ideal enterprise chain:

```
Expected → Actual counted → Difference → Reason → Manager approval → Close
```

| Step | Shift close | Day close |
|------|-------------|-----------|
| Expected | Yes (`shiftExpectedCash` / parts) | Yes (preflight + summary) |
| Counted | Yes (`countedCashUgx`) | Yes |
| Difference | Yes + `CashVarianceSummary` | Yes + flag thresholds |
| Reason | Limited (notes vary) | Reopen has reason; variance PIN path |
| Manager approval | **Informational** at shift (21.8) | **Blocking** when flagged / sync override |
| Close | `closeShiftWithHandoff` | `recordDayClose` + preflight |

Preflight blockers include: day open, no open shifts, no hospitality sessions, no pending sales, sequential prior days, cash counted, cloud sync health (with emergency/sync override paths).

**Closing Workflow: 8.0 / 10**

---

# PART 6 — Reconciliation

| Tender | In expected cash math? | Physically counted at close? |
|--------|------------------------|------------------------------|
| Cash | Yes | **Yes** |
| Card / ATM | Report breakdown | **No** |
| Mobile money | Report breakdown | **No** |
| Bank transfer | Report bucket | **No** |
| Store credit / debt | Debt issued tracked separately | **No** till count |
| Gift vouchers | **Not a first-class counted tender** | — |

`CashPositionPaymentKey` / X Report payment breakdown provide **analytics**, not closing count worksheets.

**This is the primary enterprise gap (RC-1).**

**Reconciliation: 6.2 / 10**

---

# PART 7 — Closing Reports

| Artifact | Content | Gaps |
|----------|---------|------|
| Close Day PDF (`dayCloseDocument`) | Day snapshot, cash expected/counted/diff | Not branded as “Z-Report” product |
| X Report | Mid-day sales/tenders; does not close | — |
| Shift report export | CSV/PDF from Open Shifts | — |
| Cash Position report | Movements + payment mix | Not a close certificate |
| Daily report PDF | Broader day reporting | Parallel surface |

Managers get enough **cash** information to approve close. Multi-tender “did MoMo match the provider statement?” is **not** a first-class close step.

Taxes/profit: available in broader reporting/command center; not the spine of the Close Day cash certificate.

**Reports: 7.1 / 10**

---

# PART 8 — Audit Trail

`AuditAction` coverage includes (non-exhaustive):  
`day_drawer_open` / supersede / void · `shift_start` / `shift_end` / `shift_close_count` · float verified/mismatch/override · handoff · `cash_drawer_adjustment` · cash expense lifecycle · `day_close` / blocked / preflight / override / emergency / reopened · `variance_override` · `sync_override` · `manager_override` · recovery closes.

UI: `ShiftCashAuditTimeline`, Investigation Center groupings, owner accountability sections.

**Audit Trail: 8.5 / 10**

---

# PART 9 — Exceptions

| Exception | Handling |
|-----------|----------|
| Drawer shortage / overage | Variance classify + day-close PIN when flagged; shift UX informational |
| Offline closing | Local persist + `pendingSync`; sync override / emergency paths |
| Sync pending | Preflight `cloud_sync` fail/warn + retry + override |
| Device shutdown / stale shift | Recovery wizard, force-close (`managerForceCloseOpenShift`) |
| Printer unavailable | Close is not hard-blocked on print (document/PDF paths best-effort) |
| Receipt failures | Separate from day-close commit |
| Hospitality open tables | Blocks shift/day close until resolved |
| Force-close without count | Exists; can skew day variance (known Phase 21.x risk) |

**Recovery quality:** Strong for cash/shift; printer is soft.

---

# PART 10 — Multi-user Operations

| Role | Open day | Shift | Adjust cash | Close day | Override variance |
|------|----------|-------|-------------|-----------|-------------------|
| Owner | Yes | Yes | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes | Yes | Yes |
| Supervisor | Yes (matrix) | Yes | Yes | Yes | Per matrix |
| Cashier | No | Own shift | No (`day.close`) | No | No |
| Waiter | No | Own shift | No | No | No |

Responsibilities are **clearly separated** in the permission matrix.

---

# PART 11 — Desktop Experience

- Office flows use `EnterprisePageContainer` / responsive grids.  
- No dedicated multi-pane “EOD desk” (unlike Sell rail / inventory table certifications).  
- Keyboard: form/PIN focused; no documented F-key EOD shortcuts comparable to Sell (F4/F8).  
- Multi-monitor: no special support; pages are single-column office content.

**Desktop: 6.4 / 10**

---

# PART 12 — Mobile Experience

- Cashier open/close via `ModalSheet` — touch-appropriate (`min-h-[52px]` actions).  
- Denomination counting field exists (`CashDenominationCountField`).  
- Manager approval on Close Day is form + PIN — usable on phone, dense.  
- Tablet shares responsive office layouts.

**Mobile: 7.4 / 10**

---

# PART 13 — Accessibility

| Check | Finding |
|-------|---------|
| Focus / tap | Large modal CTAs; PIN fields standard |
| Screen reader | Page headers/labels present; preflight is long |
| Contrast | Status tokens on variance summary (Phase 21.8) |
| Motion | Standard sheets |

**Accessibility: 6.0 / 10**

---

## Enterprise Benchmark Summary

| Dimension | WAKA | Typical modern enterprise POS |
|-----------|------|-------------------------------|
| Cash control | Strong (v2 ledger + preflight) | Strong |
| Shift management | Strong + recovery | Strong |
| Multi-tender close count | Weak | Strong |
| Guided EOD wizard | Fragmented routes | Often single guided close |
| Accountability / audit | Strong | Strong |
| Offline close safety | Strong (overrides + queue) | Mixed |

WAKA is competitive on **cash accountability and offline-safe closing**. It trails on **tender-complete reconciliation** and **single-path closing orchestration**.

---

## Root Cause Analysis

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| **RC-1** | **P0** | Physical reconciliation is cash-only; other tenders not counted at close | `countedCashUgx`; payment keys are report-side |
| **RC-2** | **P0** | No unified End-of-Day guided workflow | Split: Day Open, Cash Position, Shift Close, Close Day, X Report |
| **RC-3** | **P1** | Shift-close variance non-blocking (by design) | Phase 21.8; PIN enforcement at day close |
| **RC-4** | **P1** | No first-class Z-Report product identity | Close Day PDF + search keyword only |
| **RC-5** | **P1** | Force-close without count can distort day variance | `managerForceCloseOpenShift` + Phase 21.3/21.6 notes |
| **RC-6** | **P1** | Safe-drop language/discoverability | Types are `safe_transfer_out` / `bank_deposit` |
| **RC-7** | **P1** | Desktop EOD not a dedicated productivity workspace | Shared responsive pages |
| **RC-8** | **P2** | Gift voucher / store-credit counted tender absent | No close worksheet |
| **RC-9** | **P2** | Printer failure does not gate close | Soft document paths |
| **RC-10** | **P2** | EOD keyboard shortcuts underdeveloped vs Sell | No F-key close map |

---

## Operational Risks

1. **MoMo/card shops** may “close green” on cash while electronic tenders are unreconciled.  
2. **Fragmented closing** increases missed steps (expense uncleared, pending sale parked, sync pending).  
3. **Force-close / recovery** paths can leave expected cash hard to explain without reading audit timeline.  
4. **Hospitality** operators must clear floor sessions — failure mode is correct but can surprise.  
5. **v1→v2** shops mid-migration may see different float ownership semantics.

---

## P0 / P1 / P2 Roadmap (Phase 35.1 candidates)

### P0 — Closing confidence

1. **Guided End-of-Day checklist / wizard (orchestration UI)** — sequence Day Open status → open shifts → expenses → cash count → day close using existing APIs (no formula rewrite).  
2. **Multi-tender close worksheet (product decision)** — at minimum: declared MoMo/ATM totals vs system totals at day close (even if not changing cash expected math). If full counted tenders are required, scope explicitly — that is beyond pure presentation.

### P1 — Accountability & clarity

3. Surface safe-drop / bank deposit labels in Cash Position for operators.  
4. Stronger post–force-close / recovery prompts before day close.  
5. Z-Report naming + reprint from Close Day history.  
6. Desktop EOD hub (single office page composing existing panels).

### P2 — Polish

7. Keyboard shortcuts for Close Day / count confirm.  
8. Printer-unavailable guidance during close document step.  
9. Accessibility pass on preflight + PIN panels.

### Explicit non-goals for early 35.1

- Do not rewrite `computeExpectedDrawerCashV2` without a certified bug.  
- Do not merge hospitality billing into retail till.  
- Do not redesign Sell cart.

---

## Desktop / Tablet / Mobile Findings (summary)

| Band | Strength | Defect |
|------|----------|--------|
| Desktop | Enterprise office pages, Owner cash sections | No EOD command desk |
| Tablet | Shared responsive | Dense Close Day PIN + preflight |
| Mobile | Shift modals excellent | Multi-step manager close is long |

---

## Accessibility Findings (summary)

Usable for trained cashiers. Preflight lists and dual PIN paths (variance + sync) create cognitive load for infrequent managers — IA issue for 35.1, not a contrast failure.

---

## Freeze Recommendation

| Surface | Freeze? |
|---------|---------|
| Sell UI (33.1) | Yes |
| Home executive IA (34.1) | Yes for architecture |
| **EOD / cash reconciliation** | **No — conditional only** |
| v2 cash ledger formulas | Freeze unless integrity defect |

---

## Success Criteria — Answers

| Question | Answer |
|----------|--------|
| Enterprise-grade daily ops? | **Yes for cash-primary multi-cashier shops** with manager day close. |
| What blocks full certification? | **RC-1 multi-tender count** + **RC-2 fragmented EOD path**. |
| Highest-return Phase 35.1 work? | Guided close orchestration; then tender declaration worksheet. |
| Change business logic now? | **No** for checklist/wizard; tender count may need scoped product work. |

---

## Manual Certification Checklist (for Phase 35.1 acceptance)

### Opening
- [ ] Day open float establishes baseline  
- [ ] Cashier float verify / override audited  

### Closing
- [ ] Expected → counted → variance visible  
- [ ] Flagged variance requires manager approval at day close  
- [ ] Preflight blocks open shifts / pending sales / hospitality  

### Accountability
- [ ] Adjustments and expenses appear in audit  
- [ ] Recovery / force-close identifiable  

### Regression
- [ ] Expected cash formula unchanged unless scoped  
- [ ] Permissions unchanged  

---

*End of Phase 35.0 certification — read-only; no implementation in this phase.*

---

## Phase 35.1 — End-of-Day Closing Wizard

**Mode:** Surgical orchestration / presentation (no ledger rewrite)  
**Date:** 2026-08-04  

### Before vs after workflow

| Before | After |
|--------|-------|
| Fragmented Cash Position → Shift Close → Close Day → X Report | Single guided wizard on `/close-day` |
| Preflight + count + PIN stacked on one long page | Steps: Start → Health → Cash → Summary → Reports → Review |
| Operator guesses next action | Checklist rail + sticky Continue / Close |

### Closing checklist

Left rail (desktop) / step list (mobile) mirrors wizard steps and surfaces preflight pass/fail chips. Blocking close still enforced by existing `runDayClosePreflight` / `recordDayClose` — UI does not invent new gates.

### Executive summary workspace

Summary step shows total sales, transactions, refunds, expenses, cash in/out, opening float, expected cash, counted cash, and `CashVarianceSummary` — all from existing drawer/session math.

### Business Health integration

Health step embeds Phase 34.1 `HomeBusinessHealthSection` plus `CloseDayPreflightPanel` and sync-override controls (unchanged APIs).

### Multi-tender preparation (P1)

Cash step lists payment mix from `buildCashPositionReport` with clear **Counted** (cash) vs **Reported** (card/MoMo/credit/bank) badges. No change to expected-cash formula.

### Desktop / mobile

- Desktop: checklist column + step content + sticky actions  
- Mobile: same linear steps; primary CTA always sticky, `min-h-[52px]`

### Files

| Path | Role |
|------|------|
| `src/lib/endOfDayWizard.ts` | Step model |
| `src/hooks/useEndOfDayCloseSession.ts` | Shared close session (existing APIs) |
| `src/components/eod/EndOfDayClosingWizard.tsx` | Guided UI |
| `src/pages/CloseDayPage.tsx` | Hosts wizard + history/reopen |

### Regression summary

| Area | Changed? |
|------|----------|
| Cash / variance / PIN / audit / sync / DB / APIs | **No** |
| `recordDayClose` / preflight evaluation | **No** (called as before) |
| Close Day route & permissions | **No** |
| Operator workflow presentation | **Yes** |

### Verification

- `npm run build` — passed  
- `npm test` — suite green aside from known `pharmacyPatientProfile` age flake  

### Success criteria — status

| Criterion | Status |
|-----------|--------|
| Single guided EOD workflow | **Met** |
| Health + cash + summary + review in one workspace | **Met** |
| Accounting integrity unchanged | **Met** |
| UI prepared for future declared tenders | **Met** |
| Enterprise closing experience without ledger rewrite | **Met** |
