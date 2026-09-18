# WAKA POS Loyalty Implementation Status

## Project

WAKA POS Loyalty System

## Current Phase

`03-POS-INTEGRATION.md`

## Autonomous Execution

Kimi is authorized to continue from one successfully completed phase to the next without waiting for the user.

## Phase Checklist

- [x] 01 — Forensic Audit
- [x] 02 — Loyalty Data Foundation
- [ ] 02 — Loyalty Data Foundation
- [ ] 03 — POS Integration
- [ ] 04 — Merchant Loyalty UI
- [ ] 05 — Customer Enrollment
- [ ] 06 — Google + Apple Wallet
- [ ] 07 — NFC
- [ ] 08 — Rewards + Redemption
- [ ] 09 — Production Hardening
- [ ] 10 — Final E2E Audit

## Rules

A phase may be marked complete only when its acceptance criteria pass.

After each completed phase:
1. update this file;
2. update `DECISIONS.md` when needed;
3. review the diff;
4. commit the phase;
5. continue to the next incomplete phase.

Do not mark a phase complete with failing tests or unresolved high-risk defects.

## Completed Work

- Phase 01 — Forensic audit complete. Full verified architecture map in
  `FORENSIC-AUDIT-RESULT.md` (merchant/shop, customers, sale finalization via
  `finalizeDraftSale` → `shop_push_sale_complete`, refunds/voids, protected
  financial core, offline/sync, RLS, Capacitor/Android, QR/NFC/Wallet reality).
  Key findings: `customers.loyalty_points` legacy column exists but is unused
  by any code; no Wallet/NFC implementation exists; camera QR scanning works
  today; sale completion has a reliable server-side transition
  (`status → 'completed'`) usable as the loyalty award trigger.
- Phase 02 — Loyalty data foundation complete. Migration
  `20260918024500_loyalty_data_foundation.sql`: `loyalty_programs` (per-shop
  config, spend rule), `loyalty_accounts` (membership + cached counters +
  opaque `qr_token`), `loyalty_transactions` (immutable signed ledger with
  `reversal_of_id` links). DB-enforced idempotency via partial unique indexes
  (one `earned` per sale; one reversal per return/void; idempotency keys).
  Award fires from a trigger on the `sales.status → 'completed'` transition;
  return/void triggers write capped, linked reversals; the award RPC also
  applies already-synced returns/voids to close the offline ordering gap.
  All loyalty triggers are exception-guarded so loyalty can never block a
  financial write. RLS mirrors the `customers` policy pattern; the ledger has
  NO client write policies (server-only writes). Admin shop reset
  (`admin_reset_shop_business_data` + preview) now wipes loyalty
  transactions/accounts (program config survives). Client TS module
  `src/lib/loyalty/loyaltyMath.ts` for preview-only calculations.
  Tests: 16 PGlite SQL-integration tests (award math, idempotency, partial
  returns, void caps, offline ordering gap, RLS isolation, server-only
  writes, enrollment/adjustment authorization, admin reset) + 6 unit tests —
  all passing; financial-core regression batch (50 tests) green; `tsc -b`
  clean. Production application is PENDING: the Supabase project is paused
  again (pooler `EDBHANDLEREXITED` on 2026-09-18 ~02:57, same symptom as the
  earlier pause) — migration file is committed and ready to apply the moment
  the DB is resumed; not recorded in remote history yet.

## Blockers

None yet.

## Important Notes

- The repository is the source of truth.
- Protect WAKA's existing financial/inventory core.
- Loyalty points require an auditable ledger.
- Duplicate point awards must be prevented server-side/database-side.
- QR is the universal fallback for customer identification.
- Wallet/NFC capabilities must be verified rather than assumed.
