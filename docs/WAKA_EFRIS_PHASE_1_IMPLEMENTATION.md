# WAKA POS — EFRIS Phase 1: Internal Plumbing

**Date:** 2026-08-28  
**Status:** Internal plumbing only. **Not** EFRIS-compliant. **Not** URA-approved. **Not** production-ready for fiscal submission.

**URA API calls made: 0**

Phase 0: `docs/WAKA_EFRIS_PHASE_0_ARCHITECTURE.md`  
Phase 2A contract intake (no API): `docs/WAKA_EFRIS_URA_CONTRACT.md`  
Field mapping workbook: `docs/WAKA_EFRIS_FIELD_MAPPING.md`

---

## What this phase is

Shop-scoped optional EFRIS configuration, an idempotent outbox, a post-complete enqueue hook, and a fail-closed Edge Function stub.

EFRIS remains a **sibling** of the WAKA sale. Sale completion does not wait for EFRIS. `Sale.status` is never an EFRIS state. `pendingSync` is still WAKA cloud upload only.

---

## Explicit non-claims

- No URA API is called.
- No URA endpoint, authentication, payload, item code, tax mapping, FDN, credit-note, or debit-note logic was invented.
- The Edge Function returns `EFRIS_PROVIDER_NOT_CONFIGURED` and `accepted: false`.
- Products still have no VAT fields. Customers still have no TIN. Receipt-header TIN is still branding. Hospitality tax is still display-only.

---

## Files changed

| Path | Role |
|------|------|
| `supabase/migrations/169_shop_efris_plumbing.sql` | Config + outbox + RLS + RPCs |
| `src/lib/efris/types.ts` | Internal states |
| `src/lib/efris/gate.ts` | Fail-closed enabled check |
| `src/lib/efris/providerConfig.ts` | Official provider = never in Phase 1 |
| `src/lib/efris/failClosed.ts` | Submit decision; never accept |
| `src/lib/efris/states.ts` | WAKA-owned state helpers |
| `src/lib/efris/outbox.ts` | Post-complete enqueue |
| `src/lib/efris/index.ts` | Public exports |
| `src/store/usePosStore.ts` | Hook after `flushPendingPersist()` in `finalizeDraftSale` |
| `supabase/functions/efris-submit/index.ts` | Fail-closed stub |
| `supabase/functions/_shared/efrisFailClosed.ts` | Shared `isOfficialEfrisProviderConfigured()` |
| `supabase/config.toml` | `[functions.efris-submit]` |
| `package.json` | `supabase:deploy:efris` |
| `src/lib/efris/efrisPhase1.test.ts` | Unit / source-safety tests |
| `src/lib/efris/efrisPhase1.sql.integration.test.ts` | RPC isolation + uniqueness |
| `src/lib/efris/efrisPosRegression.test.ts` | Disabled-shop sale still completes |
| `src/test/sqlIntegration/efrisPgHarness.ts` | PGlite harness |
| `docs/WAKA_EFRIS_PHASE_1_IMPLEMENTATION.md` | This file |

`finalizeTableBill` calls `finalizeDraftSale`; it does not need a second hook.

---

## Database (migration 169)

### `shop_efris_config`

| Column | Notes |
|--------|--------|
| `shop_id` PK → `shops` | Shop-scoped, not organization-scoped |
| `enabled` boolean **default false** | Master switch |
| `connection_status` | `not_configured` \| `disconnected` \| `connected` \| `error` — default `not_configured`. Enabling does **not** set `connected`. |
| timestamps | `created_at`, `updated_at` |

No URL columns. No secret columns. Missing row = disabled.

### `shop_efris_submissions` (outbox)

| Column | Notes |
|--------|--------|
| `id` | UUID |
| `shop_id` | FK shops |
| `sale_id` | WAKA sale UUID (**no FK** — local complete may precede the cloud `sales` row) |
| `efris_state` | `NOT_REQUIRED` \| `PENDING` \| `SUBMITTED` \| `ACCEPTED` \| `FAILED` \| `RETRY_REQUIRED` |
| `last_error_code` / `last_error_message` | Sanitized; stub writes `EFRIS_PROVIDER_NOT_CONFIGURED` |
| **UNIQUE (`shop_id`, `sale_id`)** | Idempotency boundary |

Disabled shops: **no outbox row** (`NOT_REQUIRED` is a return value, not a stored row).

Independent of `pendingSync` and the WAKA `SyncOperation` queue.

---

## RLS / security

- RLS enabled on both tables.
- **SELECT:** `user_can_access_shop(shop_id)`.
- **INSERT/UPDATE/DELETE:** revoked from `authenticated`. Writes go through security-definer RPCs only.
- `shop_get_efris_config` — access shop; returns `enabled: false` when no row; `forbidden` cross-shop.
- `shop_set_efris_enabled` — `user_can_manage_shop` only (cashier cannot toggle).
- `shop_enqueue_efris_submission` — `user_is_cashier_or_above`; no insert when disabled.
- `shop_efris_note_provider_absent` — `user_can_access_shop`; never sets `ACCEPTED` or `SUBMITTED`.

Credentials: none stored. Ask WAKA pattern reserved for a future official provider (Edge secrets + server-only rows). Not `ShopPreferences`, snapshots, localStorage, or the Vision vault.

---

## State machine (implemented)

```text
WAKA Sale.status = completed     (unchanged; source of truth for POS)
        │
        ▼
  shop_efris_config.enabled?
        │
   no   └─ yes
    │         │
    ▼         ▼
NOT_REQUIRED  PENDING  (one outbox row per shop_id+sale_id)
(no row)         │
                 ▼
         Edge stub: EFRIS_PROVIDER_NOT_CONFIGURED
         state remains PENDING
         accepted = false
```

`SUBMITTED` / `ACCEPTED` / `FAILED` / `RETRY_REQUIRED` exist as allowed values for later phases. Phase 1 never writes `ACCEPTED` or `SUBMITTED`.

---

## Enqueue location

`src/store/usePosStore.ts` → `finalizeDraftSale`

Order:

1. Local `Sale` with `status: "completed"`
2. Stock, receipt sequence, audit, Zustand `set`
3. `queueRemote("pending_sales")` (WAKA sync — unchanged)
4. `flushPendingPersist()`
5. `enqueueEfrisAfterCompletedSale(sale.id, sale.status)` — fire-and-forget

If EFRIS is disabled, there is no shop id, or there is no cloud session: no RPC, no Edge call.

---

## Edge Function `efris-submit`

1. JWT required (`verify_jwt = true`).
2. `user_can_access_shop`.
3. `shop_get_efris_config` — disabled → `efris_disabled` / `NOT_REQUIRED`.
4. Read outbox for `(shop_id, sale_id)`.
5. `isOfficialEfrisProviderConfigured()` is **always false**.
6. `shop_efris_note_provider_absent` (error code only).
7. HTTP 503 `{ code: "EFRIS_PROVIDER_NOT_CONFIGURED", accepted: false, submitted: false }`.
8. **No `fetch` of any URA URL.**

---

## Failure behavior

| Case | WAKA sale | EFRIS |
|------|-----------|--------|
| Disabled / missing config | Completed | No outbox |
| Enabled, no official provider | Completed | PENDING + `EFRIS_PROVIDER_NOT_CONFIGURED` |
| Edge down / not deployed | Completed | Outbox PENDING (enqueue already happened) |
| Double hook / retry | Completed | Same unique row |
| Cross-shop | — | `forbidden` |

---

## Tests

- `src/lib/efris/efrisPhase1.test.ts` — gate, decision, enqueue idempotency, no invented URA URLs, hook order.
- `src/lib/efris/efrisPhase1.sql.integration.test.ts` — default off, unique outbox, Shop A ↛ Shop B, disable keeps history.
- `src/lib/efris/efrisPosRegression.test.ts` — sale + stock with EFRIS off.

---

## Future mapping (not built)

Official URA documentation is required before:

- WAKA product → EFRIS item codes
- VAT / tax class on products
- Customer TIN
- Invoice / receipt / FDN payloads
- Credit-note / debit-note documents
- Real provider credentials and endpoints
- Print overlay of fiscal identifiers

---

## Next step (do not start automatically)

Implement a real URA client **only after** official documentation and credentials exist. Replace the fail-closed stub; do not add placeholder URLs.
