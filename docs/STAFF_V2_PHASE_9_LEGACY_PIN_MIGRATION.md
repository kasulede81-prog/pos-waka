# STAFF V2 — PHASE 9: LEGACY PIN STAFF MIGRATION + IDENTITY UPGRADE

**Mode:** Implementation complete.  
**Date:** 2026-08-23  
**Live:** `ljaedextsenbkxzzgxcg` — 164 applied. 158–163 frozen. 151–157 unapplied.

---

## Verdict

```
PHASE 9 COMPLETE
Legacy PIN workers can upgrade to Auth + shop_members + linked seller.
PIN / history / shared terminal preserved.
Ready for Phase 10 reporting only when approved.
```

---

## Decisions shipped

1. **Option A** — reuse Phase 5 invitation system (no second invite stack).
2. **Migration 164** — `shop_invite_staff()` accepts `shop_pos_staff.id` **or** `client_id`; invitation always stores server PK.
3. **Dedicated upgrade UX** — `StaffLegacyUpgradeDialog` from Staff Team (generic invite card unchanged).
4. Frozen surfaces untouched: `signInStaff`, PIN auth, `staff:<id>`, `accountKey`, seller push mapping, `rowToSale`, dashboards, history.

---

## What changed

| Area | Change |
|------|--------|
| `164_staff_v2_invite_staff_id_or_client_id.sql` | RPC compatibility only |
| `StaffLegacyUpgradeDialog.tsx` | Owner email → upgrade invite for one legacy row |
| `StaffTeamList.tsx` | Upgrade action + PIN / pending / cloud badges |
| `StaffAccessPage.tsx` | Owner-only wiring + pending local state |
| `staffInvite.ts` | `isLegacyPinStaffUpgradeable`, `invitePosRoleForStaff`, pending helper |

---

## Identity lifecycle (complete)

```
Legacy PIN worker (user_id NULL)
        ↓
Upgrade invitation (Phase 5 + 164)
        ↓
Auth account
        ↓
shop_members
        ↓
shop_pos_staff.user_id
        ↓
Real seller attribution (Phases 7–8)
```

---

## Test gate

| Test | Result |
|------|--------|
| M0 client_id invite | PASS |
| M1 link same row | PASS |
| M2 PIN unchanged | PASS |
| M3 Auth membership | PASS |
| M4 Auth sale attribution | PASS |
| M5 Shared terminal | PASS |
| M6 Historical sales | PASS |
| M7 Duplicate link blocked | PASS |
| M8 Already linked rejected | PASS |
| M9 Non-owner forbidden | PASS |
| Static vitest Phase 9 | PASS (7) |

Throwaway script: `scripts/staff-v2-phase9-upgrade-tests.sql` (ROLLBACK).

---

## STOP

Do **not** start Phase 10 dashboard / `rowToSale` / cashier filter migration until separately approved.
