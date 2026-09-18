# WAKA POS Loyalty Implementation Status

## Project

WAKA POS Loyalty System

## Current Phase

`PROJECT STATUS: COMPLETE` — Phase 10 (Final E2E Audit) done; see
`PHASE10-FINAL-E2E-REPORT.md`.

## Autonomous Execution

Kimi is authorized to continue from one successfully completed phase to the next without waiting for the user.

## Phase Checklist

- [x] 01 — Forensic Audit
- [x] 02 — Loyalty Data Foundation
- [x] 03 — POS Integration
- [x] 04 — Merchant Loyalty UI
- [x] 05 — Customer Enrollment
- [x] 06 — Google + Apple Wallet
- [x] 07 — NFC
- [x] 08 — Rewards + Redemption
- [x] 09 — Production Hardening
- [x] 10 — Final E2E Audit

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
- Phase 03 — POS integration complete (commit `f1d368e`). Client data layer
  `src/lib/loyalty/loyaltyClient.ts` (program config fetch with localStorage
  offline cache, account fetch, enroll RPC — never credits points),
  `src/hooks/useLoyaltyCheckoutPreview.ts` (fully failure-isolated, resolves
  shop context from cloudSync), and `LoyaltyCheckoutBadge` rendered above the
  customer section in both checkout surfaces (`PosCheckoutPanel` credit/payment
  flow and `CreditCatalogDockPanel`). Badge shows nothing when the program is
  disabled; otherwise an attach-customer hint or balance + expected points.
  i18n keys added for en/lg/sw. Tests: loyalty suites (24 tests) + POS
  regression batches (posScanToCart 9, checkout keypad/totals 7) green;
  `tsc -b` clean.
- Phase 04 — Merchant loyalty UI complete (commit `86e67f1`). New migration
  `20260918090000_loyalty_merchant_ui.sql` with three security-definer RPCs
  that re-check authorization internally: `loyalty_shop_overview` (program
  config, member counts, issued/redeemed/reversed aggregates, 10-row recent
  activity with customer names), `loyalty_update_program` (manager-only
  upsert with spend-rule validation), `loyalty_search_accounts` (member
  directory joined to customers, name/phone ILIKE search, capped limit).
  Client layer `src/lib/loyalty/loyaltyMerchant.ts` (overview/search/history/
  save/adjust; `validateProgramInput` client guard; program cache invalidated
  after save). Page `src/pages/LoyaltyHubPage.tsx` at `/office/loyalty`
  (route guarded by `customers.view`; config + adjustment controls only for
  `settings.shop` managers; loading/empty/error states; i18n en/lg/sw).
  Entry card added to the Office hub insights section. Tests: 12 new PGlite
  SQL-integration tests (overview access/isolation/aggregates/activity,
  manager upsert, cashier/outside denial, input validation, name/phone
  search, cross-shop non-leakage) + 4 unit tests — 40 loyalty tests green;
  `tsc -b` clean.
- Phase 05 — Customer enrollment & identity complete (commit `bb9aa3e`).
  Migration `20260918100000_loyalty_enrollment_identity.sql`: extends
  `loyalty_enroll_customer` with consent recording (`p_consent_accepted`,
  `p_consent_note`, `p_metadata` — stamped into account metadata with
  timestamp + actor; old 2-arg signature dropped to avoid an overload
  ambiguity, defaults keep it source-compatible) and adds
  `loyalty_account_by_token` (access-checked opaque-token lookup for QR
  identification). Client: `src/lib/loyalty/loyaltyEnrollment.ts` (customer
  search with `normalizeUgPhoneE164` reuse, already-enrolled flagging,
  consent-gated enroll wrapper, token lookup; `WAKA-LOYALTY:` QR payload
  prefix helpers — no personal data in the QR). UI: `LoyaltyEnrollmentPanel`
  in the hub (search → consent → enroll → membership QR; camera
  scan-to-identify reusing the shared barcode adapter), `LoyaltyMemberQr`
  rendered via new `qrcode` dependency. Tests: 8 new PGlite SQL-integration
  tests (consent metadata, idempotent duplicates, backward-compat call,
  cross-shop/outsider denial, token resolution, forged-token and empty-token
  rejection) + 4 unit tests — 52 loyalty tests green; `tsc -b` clean.

- Phase 07 — NFC feasibility + implementation complete (commit `21d7b42`).
  Investigation matrix in `NFC-FEASIBILITY.md`: NDEF tag reading is the
  supported mechanism (Web NFC where exposed); Apple Wallet VAS / Google
  Smart Tap are external certifications, documented not faked; iOS stays on
  QR until a native plugin exists. Android manifest declares optional NFC
  permission; `src/services/hardware/nfcAdapter.ts` adds capability
  detection + session + pure NDEF extraction accepting only `WAKA-LOYALTY:`
  payloads; the hub scan card gains a tap action with graceful fallback.
  10 unit tests (forgery guards, payload shapes, capability matrix).
  Real-device tap testing is pending hardware — marked pending, not done.

## Blockers

- NONE for the database: the Supabase project is back and ALL FOUR loyalty
  migrations were applied to production and recorded in
  `supabase_migrations.schema_migrations` during Phase 09 (verified: 5
  tables, 12 RPCs present). Zero migrations pending.
- Wallet platform credentials are still missing (Google Wallet issuer + service
  account; Apple Developer Pass Type ID certificate + WWDR). The issuance
  pipeline is code-complete and fail-closed; see
  `WALLET-INTEGRATION.md` for the setup checklist.
- NFC real-device tap testing is still pending hardware (marked pending,
  not done).

## Important Notes

- The repository is the source of truth.
- Protect WAKA's existing financial/inventory core.
- Loyalty points require an auditable ledger.
- Duplicate point awards must be prevented server-side/database-side.
- QR is the universal fallback for customer identification.
- Wallet/NFC capabilities must be verified rather than assumed.
- Phase 06 — Google + Apple Wallet complete (commit `5e22f03`). Server-side
  issuance pipeline in `supabase/functions/_shared/loyaltyWallet/` (pure TS +
  WebCrypto): Apple pass.json (storeCard) + manifest SHA-1 + store-only ZIP
  + hand-built PKCS#7 SignedData signer (RSA-2048/SHA-256, cert + WWDR
  embedded); Google LoyaltyClass/Object builders + ES256 JWT save-URL flow
  with a WebCrypto PKCS#8 signer; validation + fail-closed orchestration.
  Edge function `loyalty-wallet-pass` reads account/customer/shop with the
  USER-context client (RLS enforces shop access), never exposes secrets,
  returns `wallet_not_configured` (409) when credentials are absent. 25 unit
  tests (CRC-32 vector, ZIP structure, manifest hashing, PKCS#7 structure +
  signature verified with a real RSA key, ES256 JWT verified with a
  WebCrypto key, fail-closed paths). External blockers (no Google issuer, no
  Apple certs) documented honestly in `WALLET-INTEGRATION.md` with a setup
  checklist; no Wallet UI ships yet; QR fallback unchanged.
- Phase 08 — Rewards + redemption complete (commit `9cc7595`). Migration
  `20260918110000_loyalty_rewards.sql`: `loyalty_rewards` merchant catalog
  (points cost, kind product/voucher/custom, optional product link, optional
  per-account cap; RLS: members read, managers write) and
  `loyalty_redemptions` (audit + idempotency; written ONLY through the
  security-definer `loyalty_redeem_reward` RPC). One redemption = one
  redemption row + one negative `redeemed` ledger row in a single
  transaction, linked both ways with unique indexes; cached balance updates
  via the existing ledger trigger so the balance invariant always holds.
  Idempotent replay: same idempotency key returns the original redemption
  (`already_redeemed`) with no second deduction. Client:
  `src/lib/loyalty/loyaltyRewards.ts` (catalog CRUD, eligibility, RPC
  wrapper), `LoyaltyRewardsPanel` (manager CRUD in the hub), two-step
  Redeem → Confirm in the customer detail card with one key generated per
  intent. i18n en/lg/sw. Tests: 8 new PGlite SQL-integration tests (catalog
  RLS, happy-path pair, replay, per-account cap, insufficient balance,
  inactive reward, cross-shop denial, balance invariant) + 7 unit tests —
  103 loyalty tests green; `tsc -b` clean.
- Phase 09 — Production hardening complete (commit `505e908`). Full audit in
  `PHASE9-HARDENING-REPORT.md`: security (RLS, isolation, RPC authz, secret
  scan clean, wallet fail-closed), data integrity (idempotency, reversals,
  offline ordering gap, balance invariant), financial regression (83
  financial + 126 retail + 41 payments + 13 cloud + 167 platform tests
  green), performance (indexes + no N+1 evidence), Android (`tsc -b` +
  `cap sync` clean), quality gates (`tsc -b`, 103 loyalty tests, production
  build PASS). DEFECT FIXED: `p0Verification.test.ts` had a time-bombed
  hardcoded `trial_ends_at: 2026-08-15` (pre-existing, unrelated to loyalty)
  now rolling `now + 30 days`. PRODUCTION: all four loyalty migrations
  applied to Supabase and recorded in remote history — zero pending.
- Phase 10 — Final E2E audit complete. The full journey is proven as ONE
  continuous production story in `loyaltyE2E.sql.integration.test.ts`
  (14 tests): merchant setup → enrollment + consent → QR identity → sale
  award → replay-safe → partial return → void → reward eligibility →
  idempotent redemption → double-redeem blocked → multi-tenant isolation
  (B sees/redeems nothing of A) → sale record untouched. Final regression:
  117 loyalty + 83 financial + 126 retail + 41 payments + 13 cloud + 167
  platform tests green; `tsc -b` clean; production build PASS; cap sync
  PASS; production Supabase fully migrated (5 tables, 12 RPCs verified).
  Full results in `PHASE10-FINAL-E2E-REPORT.md`.
