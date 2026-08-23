# STAFF V2 — PHASE 7: REAL SELLER ATTRIBUTION + SERVER VALIDATION

**Mode:** Implementation complete.  
**Date:** 2026-08-23  
**Live:** `ljaedextsenbkxzzgxcg` — 162 applied. 158–161 frozen. 151–157 unapplied.

---

## Verdict

```
PHASE 7 COMPLETE
Server trusts seller identity.
Client architecture unchanged.
Ready for Phase 8.
```

---

## What changed

1. **`staff_v2_validate_sold_by_user_id(p_shop_id, p_sale, p_writer_id)`** — Auth user + `shop_members` for this shop; else NULL. Sale never aborts.
2. **`shop_push_sale_complete` / `shop_push_pending_sale`** — call validate instead of observe.
3. **`created_by`**, fill-once coalesce, stock, financial validation — unchanged.
4. **`staff_v2_observe_sold_by_user_id`** — left intact (159).

---

## Frozen / deferred

- Client: `cloudSync`, `sessionActor`, `signInStaff`, `rowToSale`, dashboards  
- Linked PIN + `pos_staff_id` → **Phase 8**  
- Migrations 158–161  

---

## Test gate (throwaway shop, rolled back)

| Test | Result |
|------|--------|
| S1 Auth cashier | PASS |
| S2 Foreign UUID → NULL | PASS |
| S3 Other shop → NULL | PASS |
| S4 Legacy PIN / `staff:` → NULL | PASS |
| S5 Linked PIN E2E | Deferred (server membership-ready) |
| S6 Fill-once retry | PASS |

Script: `scripts/staff-v2-phase7-seller-tests.sql`  
Static: `src/lib/staffV2Phase7SellerValidation.test.ts` (5/5)  
