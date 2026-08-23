# STAFF V2 — PHASE 10: SELLER IDENTITY READ MODEL CUTOVER

**Mode:** Implementation complete.  
**Date:** 2026-08-23  
**Live:** `ljaedextsenbkxzzgxcg` — no SQL. 158–164 frozen.

---

## Verdict

```
PHASE 10 COMPLETE
UI seller = sold_by_user_id (commercial).
created_by remains writer only.
Legacy NULL sold_by falls back safely.
```

---

## What changed

1. **`rowToSale`** — `soldByUserId` / `soldByAuthUserId` from `sold_by_user_id`, else `created_by`.
2. **`saleFinancialMerge`** — `mergeCommercialSellerFields` (NULL→UUID survives; no UUID→other UUID flip).
3. **`saleSoldByMatchesActor`** — Auth / Path S linked / legacy `staff:` filters.
4. **`soldByLabels` + cash position** — resolve Auth UUID via `linkedAuthUserId`; unknown Auth ≠ owner.
5. **Wired** — Home, POS today, Receipts, pharmacy/hospitality dashboards, receipt cashier label.

---

## Frozen (unchanged)

- Migrations 158–164
- cloudSync **push** (`created_by = ctx.userId`, `sold_by` resolver)
- SessionActor / PIN / Auth / invites / sale RPCs

---

## Test gate

| Test | Result |
|------|--------|
| R1–R8 (vitest Phase 10) | PASS |
| Staff V2 Phase 2–9 static suites | PASS (assertions updated for pull remap) |

---

## End-to-end architecture

```
PIN / Auth identity
        ↓
seller attribution (Phases 7–9)
        ↓
cloud validation
        ↓
correct UI attribution (Phase 10)
        ↓
reports / Home / Receipts
```

**STOP** — no further Staff V2 phase without review.
