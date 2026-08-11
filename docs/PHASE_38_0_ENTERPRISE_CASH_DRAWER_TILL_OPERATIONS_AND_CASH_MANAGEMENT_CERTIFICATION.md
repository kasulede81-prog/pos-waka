# Phase 38.0 — Enterprise Cash Drawer, Till Operations & Cash Management Certification

**Mode:** Read-only enterprise audit (**NO code changes, NO CSS, NO SQL, NO migrations, NO dependency updates**)  
**Date:** 2026-08-04  
**Scope:** Cash Drawer workspace — day open / float, cash position, movements, expenses, safe transfers, shift cash, history/audit, desktop & mobile ops UX, integration with Sell / Home / Command Center / Back Office  
**Explicit boundary:** End-of-Day close orchestration, preflight, variance PIN, and closing wizard are **already certified in Phase 35.0 / 35.1** — referenced here only at handoff points  
**Related prior work:**  
- Phase 21.6 — shift recovery & cash drawer reliability  
- Phase 21.8 — drawer tolerance & cash variance experience  
- Phase 35.0 / 35.1 — EOD operations & guided closing wizard  
- Phase 37.0 — Back Office IA (defers cash ops to this phase)  
- `CASH_EXPENSES_FEATURE_SPEC.md`  

**Core questions:**

> Can cashiers confidently manage cash throughout the day?  
> Can supervisors audit every cash movement?  
> Can managers reconcile drawers quickly?  
> Does the workspace scale to multiple shifts and users?

---

## Executive Summary

WAKA’s cash stack is a **mature cash-primary till and cash-management system**, not a thin “open register” screen. Formula **v2** gives the day an authoritative opening float (`DayDrawerOpen`), shifts verify/handoff float, movements cover inflows/outflows (including safe transfer and bank deposit), expenses have approval workflows, and **Cash Position** presents expected drawer cash with a full breakdown, timeline, alerts, and exports.

The main gap is **workflow cohesion**, not ledger integrity:

1. Cash ops are split across **Cash Management hub**, **Cash Position**, **Cash Expenses**, **Day Open**, **Open Shifts**, and **Close Day** — powerful but fragmented.  
2. **Cashiers** run the till on Sell (shift open/close) but are **route-blocked** from the Cash Management hub (`day.close` required) even though `canAccessCashManagement` lists `cashier`.  
3. **Safe drop** exists as `safe_transfer_out` in the ledger without clear “Safe Drop” product language.  
4. Preflight / close-day **count deep-link** points at `/office/cash-drawer#count`, while `#count` handling lives on **Cash Position**.  
5. Multi-tender remains **analytics-only** at close (Phase 35) — Cash Position shows tender mix but physical reconcile is cash.

| Persona | Fit |
|---------|-----|
| Cashier (shift float + sell + optional expenses) | **Good** on Sell; **weak** mid-day drawer visibility |
| Supervisor / Manager (movements, position, approve expenses) | **Strong** |
| Owner (oversight, settings, variance history, CC) | **Strong** |
| Multi-cashier handoff (v2) | **Good** |
| Multi-tender close (card/MoMo counted) | **Weak** (boundary; Phase 35) |

**Overall certification status: CONDITIONALLY CERTIFIED for cash-primary retail / pharmacy / supermarket till operations. NOT CERTIFIED as a single unified enterprise cash console** — surfaces are capable but fragmented.

**Freeze recommendation:** **Freeze the v2 cash ledger and expected-cash formula** (`computeExpectedDrawerCashV2`, day-open authority) unless a P0 integrity bug appears. Do **not** freeze cash **workspace IA / discoverability / deep-links**. Phase 38.1 should consolidate operator journeys and naming without rewriting reconciliation math. Defer Back Office hub consolidation to Phase 37.1 (still recommended after this audit).

---

## Score Table

| Category | Score | Verdict |
|----------|------:|---------|
| Information Architecture | **6.8** | Capable surfaces; fragmented home |
| Daily Workflow | **7.6** | Full lifecycle; discovery gaps |
| Cash Position | **8.0** | Clear expected + breakdown + alerts |
| Cash Movements | **7.5** | Rich types; UX naming / gates |
| History & Audit | **7.7** | Strong feeds; IC category narrow |
| Desktop | **6.8** | Exports good; not a till desk |
| Mobile | **7.5** | Touch-friendly; long pages |
| Integration | **7.4** | Many links; some wrong deep-links |
| Accessibility | **6.5** | Large targets; dense stacks |
| **Overall** | **7.4 / 10** | Conditional cash-primary enterprise |

---

## Certification Methodology

1. Static forensics of cash routes, pages, ledger libs, permissions, and hub cards.  
2. Boundary respect for Phase 35/35.1 EOD wizard (not re-scored).  
3. Persona click-path analysis (cashier / supervisor / owner).  
4. Cross-check Phase 21.6 / 21.8 / 37.0 findings.  
5. No live device Systrace in this phase.

---

## Workflow Diagram

```
OWNER / MANAGER
  Day Open (/office/day-open) ──recordDayDrawerOpen(openingFloat)──► DayDrawerOpen (v2)
         │
CASHIER (Sell)
  Shift open ──verify float (+ optional manager PIN)──► beginShiftV2
         │
DURING DAY
  Sell cash sales ──────────────────────────────► expected drawer ↑
  Debt cash collections ────────────────────────► expected drawer ↑
  Cash Position movements* ── cash_added / cash_removed
                            ── safe_transfer_in / safe_transfer_out
                            ── bank_deposit / owner_* / float_replenishment
  Cash Expenses (/cash-expenses) ── pending → approve/reject ─► expected ↓
  X Report (non-closing mid-day)
         │
SHIFT CLOSE (Sell / recovery)
  Count vs shiftExpectedCash → variance UX → optional handoffFloat
         │
EOD BOUNDARY (Phase 35 / 35.1 — not re-certified here)
  Close Day wizard → Health → Cash count → Summary → Reports → Review / PIN
  Prefill count from Cash Position sessionStorage when used

* Movements require day.close → supervisor+ (not cashier)
```

**Natural mental model vs product:**

| Expected step | Where it lives today | Naturally connected? |
|---------------|----------------------|----------------------|
| Opening float | `/office/day-open` (+ alert) | Yes for managers |
| Sales | Sell `/pos` | Yes |
| Cash movements | `/office/cash-position` | Separate from hub |
| Expenses | `/cash-expenses` | Separate route |
| Drawer position | Cash Position + hub banner | Split |
| Reconciliation count | Cash Position `#count` + Close Day | **Deep-link mismatch** |
| Shift close | Sell modals / recovery | Yes for cashiers |
| Day close | `/close-day` wizard | Boundary (strong after 35.1) |

---

# PART 1 — Information Architecture

### Surfaces

| Surface | Route | Permission | Role |
|---------|-------|------------|------|
| Cash Management hub | `/office/cash-drawer` | `day.close` | Live balance, nav cards, feeds, shortages |
| Cash Position | `/office/cash-position` | `day.close` + sensitive gate | Full ops dashboard |
| Day Open | `/office/day-open` | `day.open_drawer` | Authoritative float |
| Open Shifts | `/office/open-shifts` | `back_office.access` | Recovery / oversight |
| Cash Expenses | `/cash-expenses` | `expenses.record` (+ staff policy) | Expense lifecycle |
| Drawer settings | `/settings/cash-drawer` | `day.open_drawer` + settings gate | Formula, tolerance, correction |
| Close Day | `/close-day` | `day.close` | **EOD boundary** |
| Hardware kick | printer/adapter | — | Not business float |

### Strengths

- Office Daily + Home tiles + Command Center cash card provide multiple discoverable entries.  
- Hub (`CashManagementPage`) acts as a **router + health banner** into day-open, position, close-day, open-shifts.  
- v2 day-owned float is a clear enterprise model.

### Weaknesses

- No single “Cash Drawer workspace” with persistent sub-nav (Position / Movements / Expenses / History).  
- Hub vs Position responsibility split is unclear to new supervisors.  
- `canAccessCashManagement` includes cashier/stock_keeper but route requires `day.close` — dead allowlist.  
- Cash expenses sit outside `/office/cash-*` path family.

**Information Architecture: 6.8 / 10**

---

# PART 2 — Daily Cash Workflow

| Step | Discoverable? | Connected? | Notes |
|------|---------------|------------|-------|
| Opening float | Yes (alert + settings + hub) | Strong | v2 `DayDrawerOpen` |
| Cash received (sales) | Via Sell | Strong | Feeds expected cash |
| Cash paid out / in | Cash Position form | Medium | Needs `day.close` |
| Expenses | Office card / route | Medium | Approval path solid |
| Safe drops | As `safe_transfer_out` | Weak naming | Ledger-ready |
| Drawer adjustments | Same movement form | Medium | Reason/note; no approval |
| Closing balance | Shift close + EOD | Strong at boundary | Phase 35.1 wizard |

**Cashier confidence:** High for shift start/close on Sell; **low** for mid-day “how much should be in the drawer?” (no Cash Position access).  
**Supervisor reconcile speed:** High once on Cash Position; setup cost is learning which of 4–5 routes to use.

**Daily Workflow: 7.6 / 10**

---

# PART 3 — Cash Position

Canonical expected cash (v2):

```
openingFloat
+ cashSales + debtCollections + adjustmentInflows
− expenses − supplierPayments − cashRefunds − adjustmentOutflows
→ max(0, expected)
```

Evidence: `computeExpectedDrawerCashV2` in `cashDrawerLedger.ts`; assembled via `getDrawerCashForDayInput` / `buildCashPositionReport`.

| Question | Answer in product |
|----------|-------------------|
| Current / expected balance? | Hero + breakdown on Cash Position; banner on hub |
| Opening float? | Breakdown line + day-open record |
| Sales / expenses / movements? | Breakdown + payment mix + activity timeline |
| Pending reconciliation? | Alerts (“not counted today”); close-day preflight (boundary) |
| Always understand state? | **Supervisors yes** on Cash Position; cashiers rely on shift expected at close |

**Cash Position: 8.0 / 10**

---

# PART 4 — Cash Movements

| Type | Ledger | Operator language |
|------|--------|-------------------|
| Cash In | `cash_added` | Present |
| Cash Out | `cash_removed` | Present |
| Expense | `CashExpense` (separate) | Strong + approvals |
| Float adjustment | `float_replenishment`, injections/withdrawals | Present |
| Safe drop | `safe_transfer_out` / `safe_transfer_in` | Technical labels |
| Bank deposit | `bank_deposit` | Present |
| Opening float adj | `opening_float` type exists | v2 prefers Day Open page |

| Criterion | Verdict |
|-----------|---------|
| Workflow | Form on Cash Position; gated to closers |
| Auditability | `cash_drawer_adjustment` audit + actor + note |
| Discoverability | Behind Cash Position / hub card |
| Speed | Adequate for supervisors; not one-tap for cashiers |

**Cash Movements: 7.5 / 10**

---

# PART 5 — History & Audit Trail

| Signal | Present? | Where |
|--------|----------|-------|
| Timestamps | Yes | Adjustments, expenses, shifts, day opens/closes |
| Cashier / actor identity | Yes | Feeds, expense approver fields, shift records |
| Reasons / notes | Yes | Movement note; expense category/reason |
| Approvals | Expenses yes; **adjustments no** | `CashExpensesPage` |
| Overrides | Float verify PIN; EOD variance PIN (boundary) | Shift / close-day |
| Variance history | Yes (owner-gated) | Cash Management hub |
| Investigation | Partial `cash_drawer` category | Audit Center |

Investigations are **straightforward for supervisors on hub + Cash Position timeline**; Audit Center coverage of the full day lifecycle is broader than the `cash_drawer` filter alone (day_open / day_close live in wider audit sets — Phase 35).

**History & Audit: 7.7 / 10**

---

# PART 6 — Desktop Workspace

| Capability | Status |
|------------|--------|
| Tables | Open Shifts + Cash Expenses responsive tables; Position is collapsible card stack |
| Filters | Date chips / day scope on Position; limited global cash history browser |
| Search | No dedicated cash-movement search desk |
| Exports | Strong on Cash Position (PDF/CSV/Excel/share) + shift CSV/PDF |
| Keyboard | Numeric count fields; no cash-ops shortcut map |
| Density | Hub cards OK; Position long vertical — underuses widescreen columns |

**Desktop: 6.8 / 10**

---

# PART 7 — Mobile Workflow

| Criterion | Verdict |
|-----------|---------|
| Touch workflow | Large min-heights on day-open / count / save |
| Dialog usability | `ModalSheet` for expenses; PIN pads for corrections |
| One-handed | Hub nav cards work; Position scroll is long |
| Key actions visibility | Day-open alert + hub cards surface primary next steps |

**Mobile: 7.5 / 10**

---

# PART 8 — Integration

| System | Integration quality | Notes |
|--------|---------------------|-------|
| Sell | Strong | Shift gateway; cash sales → expected |
| End-of-Day | Strong boundary | Wizard + prefill; **count deep-link wrong host** |
| Reports | Good | X-report, close docs, Position exports |
| Command Center | Strong | Cash card KPIs + attention links |
| Back Office | Medium | Office Daily card; Phase 37 fragmentation |

Confirmed deep-link defect:

- Preflight navigates to `/office/cash-drawer?...#count` (`dayCloseEnforcement.ts`).  
- `#count` handler is on `CashPositionPage` only.  
- Cash Management hub has **no** `#count` section.

**Integration: 7.4 / 10**

---

# PART 9 — Business Health

| Signal | Surfaced early? | Where |
|--------|-----------------|-------|
| Overages / shortages | At shift/day close + hub variance | Variance UX (21.8); hub history |
| Pending reconciliation | Yes | Position alerts; EOD preflight |
| Unusual movements | Partial | Large withdrawal alert (~UGX 500k); high refunds % |
| Safe limit | Yes | Position safe-limit card/alerts |
| Negative expected | Critical alert | Position |
| Float mismatches | Hub feed | Verification mismatches |
| Unresolved variance (CC) | Badge / attention | Command Center |

Problems surface **well for managers on Position/CC**; cashiers mostly learn issues at **shift close**, not mid-shift.

---

# PART 10 — Accessibility

| Area | Status |
|------|--------|
| Keyboard | Form/tab order OK; no ops shortcut layer |
| Focus | Dialogs/PIN flows structured |
| Screen readers | Enterprise headers help; emoji section icons on Position weaken semantics |
| Touch targets | Consistently large on critical cash actions |
| Contrast | Status tokens on variance/unbalanced banners |

**Accessibility: 6.5 / 10**

---

# PART 11 — Enterprise Benchmark (workflow reference only)

| Expectation | WAKA |
|-------------|------|
| Clear till accountability per cashier | Strong (shifts + verify + handoff) |
| Mid-day safe drops with simple language | Ledger yes; UX language weak |
| Always-visible expected drawer | Strong for supervisors; weak for cashiers |
| Fast reconcile before close | Strong Position + Phase 35.1 wizard |
| Full tender count at close | Cash only (Phase 35 gap) |
| Single cash console | Fragmented multi-route |
| Audit every movement | Strong with note/actor; adj approvals lag expenses |

Focus: accountability, reconciliation, auditability, operational confidence — not copying layouts.

---

# PART 12 — Root Cause Register

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| **RC-1** | **P0** | Fragmented cash workflow across hub / position / expenses / day-open / close-day | Routes in `App.tsx`; Office + Home entries |
| **RC-2** | **P0** | Close-day / preflight count deep-link lands on Cash Management, but `#count` is implemented on Cash Position | `dayCloseEnforcement.ts` L429 vs `CashPositionPage.tsx` L72–76 |
| **RC-3** | **P1** | Cashier listed in `canAccessCashManagement` but route requires `day.close` — cashiers never use the hub | `cashManagementSnapshot.ts` L131–138; `App.tsx` L496–500 |
| **RC-4** | **P1** | Safe drop exists as ledger types without operator-facing “Safe Drop” workflow language | `safe_transfer_out` / labels in `cashDrawerLedger.ts` |
| **RC-5** | **P1** | Drawer state visibility gap for cashiers mid-day | No Cash Position without `day.close` |
| **RC-6** | **P1** | Desktop productivity — Cash Position card-stack, not a till operations desk | `CashPositionPage` / sections |
| **RC-7** | **P2** | Adjustment movements lack expense-style approval workflow | Movement form vs `CashExpensesPage` |
| **RC-8** | **P2** | Investigation Center `cash_drawer` filter narrower than full day cash lifecycle audits | `activityPresentation` cash_drawer set |
| **RC-9** | **P2** | Multi-tender physical reconciliation still analytics-only | Phase 35 boundary — unchanged |
| **RC-10** | **P2** | Hardcoded large-withdrawal threshold (~500k) vs configurable policy | Position alerts builder |

---

## P0 / P1 / P2 Roadmap (Phase 38.1+)

### P0 — Workflow correctness & cohesion

1. **Fix count deep-link** — preflight / close-day `#count` must open Cash Position (or implement count on hub).  
2. **Unify cash operator home** — treat Cash Management as shell with clear tabs/sections: Position · Movements · Expenses · Shifts · Close (routes can remain; chrome must feel one).  
3. **Align cashier access story** — either expose a cashier-safe “Till status” (expected + own shift) or remove cashier from `canAccessCashManagement` and document Sell-only path.

### P1 — Operational clarity

4. **Safe Drop / Bank Deposit** operator language and defaults in movement UI (map to existing ledger types — no formula change).  
5. Surface mid-day expected cash to cashiers (read-only card on Sell or limited Position).  
6. Desktop: sticky expected/variance summary + denser movement history table.  
7. Ensure Office/Home/CC links consistently prefer the unified shell.

### P2 — Enterprise depth

8. Optional approval policy for large adjustments (parity with expenses).  
9. Configurable unusual-movement thresholds.  
10. Broader Audit Center cash lifecycle preset.  
11. Multi-tender closing counts — **product decision** (extends Phase 35; may touch reconcile math — keep gated).

### Explicit non-goals for early 38.1

- Do **not** change `computeExpectedDrawerCashV2` / day-open authority.  
- Do **not** weaken variance PIN / preflight hard stops.  
- Do **not** merge Back Office IA work here (Phase 37.1).  
- Do **not** re-open EOD wizard structure unless deep-link/handoff only.

---

## Desktop Findings

| Strength | Defect |
|----------|--------|
| Enterprise hub header + nav cards | No persistent cash sub-nav |
| Position exports (PDF/CSV/Excel/share) | Position is long card stack |
| Shifts / expenses tables | Movement history not a first-class desktop table |
| Command Center cash KPIs | Ultrawide density unused |

---

## Mobile Findings

| Strength | Defect |
|----------|--------|
| Large day-open / count / save targets | Cash Position scroll length |
| Expense modal sheet | Many hops: hub → position → expenses |
| Day-open alert CTA | Cashiers never see manager hubs |
| Denomination helpers | Dense collapsibles |

---

## Accessibility Findings

- Critical cash actions generally meet touch-target expectations.  
- Variance / unbalanced banners use status tokens.  
- Emoji-led Position sections are weaker for SR than Lucide + text.  
- No dedicated cash keyboard map; PIN dialogs are the main focus traps (acceptable).  
- Permission-denied redirects must keep focus predictable (standard app pattern).

---

## Enterprise Comparison (summary)

WAKA already exceeds many SMB POS tools on **shift recovery, float verification, expense approvals, and expected-cash transparency** for cash-primary shops. It trails enterprise till suites on **single-console cohesion, cashier mid-day visibility, safe-drop language, and multi-tender counted close**.

---

## Regression Risk Assessment (for Phase 38.1)

| Change type | Risk to ledger / audit integrity |
|-------------|----------------------------------|
| Deep-link host fix | **Low** |
| Shell / tab chrome over existing routes | Low |
| Rename safe-drop labels (same types) | Low |
| Cashier read-only expected cash | Low–medium (permission design) |
| Adjustment approvals | Medium (new gates; don’t alter signed amounts) |
| Formula / expected-cash rewrite | **High — out of scope** |

---

## Freeze Recommendation

| Surface | Freeze? |
|---------|---------|
| `computeExpectedDrawerCashV2` / day-open authority | **Yes** |
| Expense approval business rules | **Yes** (UX only) |
| EOD preflight hard stops / variance PIN | **Yes** |
| Cash workspace IA, deep-links, naming, cashier visibility | **No** — Phase 38.1 |
| Multi-tender counted close | Product-gated; not silent scope creep |

---

## Success Criteria — Answers

| Question | Answer |
|----------|--------|
| Can cashiers confidently manage cash all day? | **Shift start/close: yes. Mid-day drawer insight: limited.** |
| Can supervisors audit every movement? | **Yes** via Position timeline, hub feeds, audits; IC filter incomplete. |
| Can managers reconcile quickly? | **Yes** on Cash Position + Phase 35.1 close wizard — if they land on the right screen. |
| Scale to multiple shifts/users? | **Yes** (v2 handoff, open-shifts recovery) for cash-primary shops. |
| World-class cash console? | **Not yet** — integrity strong; workspace cohesion incomplete. |

---

## Manual Certification Checklist (for Phase 38.1 acceptance)

### Workflow
- [ ] Preflight “count cash” opens the surface that actually shows count UI  
- [ ] Supervisor can complete day-open → movement → expense → position → close without guessing hubs  
- [ ] Safe drop / bank actions are obvious in movement UI  

### Personas
- [ ] Cashier path documented and consistent (Sell till vs any new read-only status)  
- [ ] `canAccessCashManagement` matches real routes  

### Integrity regression
- [ ] Expected cash unchanged for identical inputs  
- [ ] Day-open v2 still authoritative  
- [ ] Expense approvals still required where configured  
- [ ] EOD wizard still completes with PIN / variance rules  

### Desktop / Mobile
- [ ] Expected balance visible without hunting  
- [ ] Touch targets remain ≥48px on primary cash actions  

---

*End of Phase 38.0 certification — read-only; no implementation in this phase.*  
*Recommended sequencing: Phase 38.1 (cash workspace cohesion) and/or Phase 37.1 (Back Office IA) as separate tracks — different personas, different success criteria.*
