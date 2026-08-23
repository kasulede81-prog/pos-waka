# STAFF V2 — PHASE 8: REAL SHARED TERMINAL PIN ATTRIBUTION

**Mode:** Implementation complete.  
**Date:** 2026-08-23  
**Live:** `ljaedextsenbkxzzgxcg` — 163 applied. 158–162 frozen. 151–157 unapplied.

---

## Verdict

```
PHASE 8 COMPLETE
Shared terminal PIN attributes linked Auth sellers.
Legacy PIN unchanged. Path L signInStaff frozen.
Ready for Phase 9 only when approved.
```

---

## What changed

1. **Migration 163** — `shop_pos_staff_download` / `shop_pos_staff_list` emit `user_id`.
2. **`StaffAccount.linkedAuthUserId`** — cached from cloud `user_id`.
3. **`SessionActor.linkedAuthUserId`** — Path S lock-screen / switch-user; `userId` stays `staff:<id>`.
4. **`Sale.soldByAuthUserId`** — stamped at finalize/pending for offline sync.
5. **`cloudSync`** — `created_by = ctx.userId`; `sold_by_user_id = resolveSoldByAuthUserIdForPush(sale)`.

---

## Frozen

- `signInStaff` + Auth `signOut`
- `accountKey` (shared terminal stays `sb:<device owner>`)
- `SessionActor.userId` = `staff:<id>` for PIN
- Phase 7 validator
- `rowToSale` / dashboards / filters

---

## Test gate

| Test | Result |
|------|--------|
| P1 Linked PIN | PASS (static + SQL) |
| P2 Legacy PIN | PASS |
| P3 Offline stamp | PASS (static) |
| P4 Fill-once | PASS (SQL) |
| P5 accountKey | PASS (static) |
