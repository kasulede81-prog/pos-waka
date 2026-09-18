# WAKA POS Loyalty — Phase 09 Production Hardening Report

Date: 2026-09-18
Branch: `waka/hospitality-business-type`
Scope: security, data integrity, financial regression, offline, performance, Android, quality.

## 1. Security

| Check | Result | Evidence |
|---|---|---|
| RLS policies on all 5 loyalty tables | PASS | `select` = `user_can_access_shop`; rewards `insert/update` = `user_can_manage_shop`; redemptions client-writable = none (RPC only); ledger has no client write policies |
| Merchant isolation | PASS | PGlite RLS tests: shop B owner reads 0 rows of shop A (rewards, accounts, tokens, redemptions) |
| Staff permissions | PASS | Cashier denied reward creation (insert raises); adjust/enroll/update program require manage permission — tested |
| Server-side validation | PASS | All writes via security-definer RPCs that re-check `user_can_access_shop` internally; spend-rule and reward input validation in SQL |
| Secret handling | PASS | Edge function reads `GOOGLE_WALLET_*` / `APPLE_*` only from `Deno.env`; repo-wide scan (`password/secret/private_key` assignment patterns) found no hardcoded secrets — only i18n labels |
| Wallet credentials | PASS (fail-closed) | Function returns `wallet_not_configured` (409) when secrets absent; documented in WALLET-INTEGRATION.md |
| QR/NFC validation | PASS | Only `WAKA-LOYALTY:`-prefixed payloads resolve; forged/foreign-shop tokens return `not_found` (tested) |
| Reward authorization | PASS | `loyalty_redeem_reward` checks access, account active, reward active, per-account cap, balance; cross-shop redeem → `forbidden` (tested) |
| Points adjustment authorization | PASS | `loyalty_adjust_points` manager-only, tested |

## 2. Data Integrity

| Check | Result | Evidence |
|---|---|---|
| Duplicate sale award prevention | PASS | Partial unique index: one `earned` row per sale; re-update of completed sale replays returns `already_completed` without second award (Phase 02 tests) |
| Duplicate points / redemption | PASS | One completed redemption per idempotency key (partial unique index + RPC early-return); replay test asserts balance and row count unchanged |
| Refund reversals | PASS | Capped, linked reversal rows; partial refunds tested |
| Void reversals | PASS | Capped by outstanding; tested |
| Redemption concurrency | PASS (design + test) | Balance check + insert in one transaction; same-key races resolve via unique index, different-key races hit `insufficient_points`; deterministic test covers the latter |
| Offline sync / retry | PASS | Loyalty is server-side only; sale completion awards via DB trigger so offline-queued sales award exactly once when synced; award RPC applies already-synced returns/voids to close the ordering gap (tested); checkout badge fully failure-isolated |
| Balance invariant | PASS | `balance = earned − redeemed` maintained by `trg_loyalty_tx_balance`; asserted in Phase 08 tests |

## 3. Financial Regression

Loyalty touches no financial code. Regression batches run after all loyalty phases:

- `saleFinancialEngine`, `saleLifecycle`, `voidCompletedSale`, `saleReturnCeilings` + integrity: **83 tests passed**
- Retail domain (POS checkout, discounts, holds, credit): **126 tests passed**
- Payments domain: **41 tests passed**

Sale totals, payments, COGS, stock, refunds, voids, cash drawer: unchanged (no financial-core file modified by Phases 02–08; full diff reviewed per phase).

## 4. Offline

- POS offline sales flow through the existing sync engine; loyalty award happens in the DB on the completed-sale transition, so ordering gaps (return syncs before its sale) are closed by `loyalty_apply_pending_reversals` — tested.
- No client loyalty write path exists to queue or duplicate.
- Repeated reconnect / duplicate sync: award idempotency is DB-enforced.

## 5. Performance

- Indexes present: `loyalty_accounts (shop_id, customer_id)` unique, `(shop_id, status)`; `loyalty_transactions (account_id, created_at desc)`, partial unique idempotency index, `(shop_id, created_at desc)`; `loyalty_rewards (shop_id, active, sort_order)`; `loyalty_redemptions (account_id, created_at desc)`, `(reward_id)`; redemptions ledger unique index.
- `loyalty_shop_overview` / `loyalty_search_accounts` are single queries with capped limits (no N+1); account history is fetched per expanded customer only (one query per expansion).
- Checkout preview is two small reads with a localStorage cache; badge renders nothing when the program is disabled (zero queries).
- No optimization performed beyond the above; nothing measured as slow.

## 6. Android

- `tsc -b` clean (full app + tests).
- `npx cap sync` succeeds (web copy + Android/iOS plugin update).
- NFC permission is optional (`required=false`) — install never blocks on hardware.
- Gradle/device build not run in this environment (no Android SDK invocation here); no native code changed by Phases 02–08 except the manifest permission line.

## 7. Quality Gates

| Gate | Result |
|---|---|
| `tsc -b` | PASS |
| Loyalty suites (14 files) | 103 tests PASS |
| Financial regression | 83 tests PASS |
| Retail / payments / cloud / platform domains | 126 / 41 / 13 / 167 PASS |
| Production build (`npm run build`) | PASS (30.7s, PWA generated) |
| Secrets committed | NONE |
| Pending migrations | ZERO — all four loyalty migrations applied to production Supabase and recorded in `supabase_migrations.schema_migrations` (verified: tables + 12 RPCs present) |

## 8. Defect Found & Fixed During Hardening

- `src/lib/p0Verification.test.ts` P0-3 used a hardcoded `trial_ends_at: 2026-08-15`, time-bombing three tests after that date (pre-existing, unrelated to loyalty). Fixed to a rolling `now + 30 days`. Retail batch now fully green (126/126).

## 9. Acceptance Criteria

- [x] Security audit passed
- [x] Multi-tenant isolation verified
- [x] Idempotency verified
- [x] Refund/void verified
- [x] Offline/sync verified
- [x] Financial regression tests pass
- [x] Android build passes (typecheck + cap sync; Gradle not run here)
- [x] Production build passes
- [x] No secrets committed
- [x] No unresolved high-risk defects (Wallet/NFC external credential gaps remain documented blockers, fail-closed by design)
