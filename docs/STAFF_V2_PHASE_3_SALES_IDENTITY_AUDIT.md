# STAFF V2 — PHASE 3 SALES IDENTITY AUDIT

**Scope:** Observe-only dual-write of `sales.sold_by_user_id` when the commercial seller is already a verified Auth UUID.  
**Mode:** Static forensic audit + implementation plan. No code, no migration, no SQL applied.  
**Date:** 2026-08-23  
**Repo:** pos-waka  
**Depends on:** `docs/STAFF_V2_PHASE_1_SCHEMA_AND_IDENTITY_AUDIT.md`, migration `158_staff_v2_identity_foothold.sql` (unapplied to staging/production).

Legend: **EVIDENCE** · **INFERENCE** · **RECOMMENDATION**

---

# 1. Executive verdict

**B. SAFE WITH SPECIFIC PRECONDITIONS**

WAKA can begin writing `sales.sold_by_user_id` for genuine Auth UUID sellers **without changing PIN-staff behavior**, but not by client payload alone.

**EVIDENCE:** `shop_push_sale_complete` (latest: `120_sale_price_validation.sql`) unpacks only named keys. Extra JSON is ignored. `sold_by_user_id` will stay NULL until a follow-on RPC migration writes it.

Preconditions (all required before implementation):

1. **Apply Phase 2 migration 158** on the target database first. The column must exist.
2. **A Phase 3 migration (proposed 159, not created)** must teach `shop_push_sale_complete` and `shop_push_pending_sale` to persist `sold_by_user_id`. Do not change `created_by`.
3. **Client write is additive only** in `buildSalePushPayload` / `buildPendingSalePushPayload`. The `created_by` ternary stays byte-for-byte.
4. **Do not change `rowToSale` or dashboard filters in Phase 3.** Pull still maps `soldByUserId` from `created_by`. Changing pull now would keep overwriting `staff:<id>` and could also start mixing a second cloud field into the overloaded local string.
5. **Never convert `staff:<id>`.** If `isUuid(soldByUserId)` is false, send `sold_by_user_id: null`.
6. **RPC must not abort the sale** if `sold_by_user_id` is a well-formed UUID that is not in `auth.users`. Existence-check → NULL. Do not substitute the owner. Invalid format is prevented by the client `isUuid` gate (same regex already used for `created_by`).

If those hold, Scenario A (Auth seller) dual-writes, Scenario B (PIN) stays NULL + current remap, and dashboards do not change.

Not A: RPC ignore + unapplied 158 + overloaded local `soldByUserId` make a “just add a JSON key” change insufficient.  
Not C: no identity architecture replacement is required for this dual-write.

---

# 2. Current end-to-end identity trace

## 2.1 SessionActor matrix

**EVIDENCE** — `src/lib/sessionActor.ts` `resolveSessionActor`. Shop is **not** on `SessionActor`. Cloud shop is resolved later by `resolveShopCtx()` → `resolvePrimaryOrganizationForUser` (`src/offline/cloudSync.ts`). PIN login reuses the owner `accountKey` (`src/hooks/useAuth.ts`).

| Session type | `SessionActor.userId` format | Real Auth UUID? | Shop on actor? |
|--------------|------------------------------|-----------------|----------------|
| Owner email/password | `user.id` | **Yes** | No — primary shop at sync |
| Google / Apple Auth | `user.id` | **Yes** | No — same |
| Authenticated `shop_members` cashier (if they sign in with Auth) | `user.id` | **Yes** | No — same |
| Legacy PIN staff (`staffSession`) | `` `staff:${staffId}` `` | **No** | No — owner namespace |
| Owner lock-screen / switch user (`activeStaffId`) | `` `staff:${activeStaff.id}` `` | **No** (Auth session may still exist) | No |
| Local mode (no Supabase user) | `` `local:${email}` `` or `local:anonymous` | **No** | No |
| Restored Auth session | `user.id` | **Yes** | No |
| Restored PIN session | `` `staff:${staffId}` `` | **No** | No |
| Recovery bootstrap | `user.id` unless `activeStaffId` set | Usually **Yes** | No |

Callers (**EVIDENCE**): `AppShell.tsx` (installs into the store), `OnboardingRouteGate.tsx`, `staffAuthentication.ts` `buildStaffSessionActor`, `recoverySystemActor.ts`. Store write: `usePosStore.setSessionActor`.

## 2.2 Local sale creation

Seller is always `state.sessionActor?.userId` (or preserved from an existing pending sale).

| Path | File / symbol | `soldByUserId` |
|------|----------------|----------------|
| Completed checkout | `usePosStore.finalizeDraftSale` (~4317) | `actorId = sessionActor?.userId ?? null` |
| Hold / pending | `savePendingSale` (~4018) | current actor, else existing |
| Open table / hospitality drafts | `openTable` and related (~3130, 3207, 3286, 3352, 3399) | current actor |
| Merge tables | `mergeTableSessions` (~3507) | **target sale’s existing** seller |
| `buildPendingSaleFromDraft` | `src/lib/hospitality.ts` (~347) | input or existing |
| Snapshot normalize | `normalizeSale` (~1698) | pass-through |
| Legacy import | `src/offline/migrateLegacyStore.ts` | **null** |

**EVIDENCE answers:**

1. Seller originates from `SessionActor.userId` at write time. Finalize **overwrites** with the **current** actor, not the pending opener.
2. It is already a genuine Auth UUID when the actor is an Auth user and **not** PIN-switched.
3. It is `staff:<id>` for PIN login and owner switch-user.
4. It is **null** if `sessionActor` is unset, or after legacy migrate.
5. Owner / Google / Apple / Auth-member sales have UUID `soldByUserId`.
6. `staff:` and `local:` are **not** treated as Auth users by `isUuid` (see §3). A raw UUID without prefix **is** treated as Auth for `created_by` today — that is the existing `created_by` contract, not a Phase 3 invention.

Void/return do **not** create a new `Sale` seller. `voidSaleLine` mutates lines. Returns are `ReturnRecord`s with `actorUserId` / `created_by` in a separate push (`cloudSync.ts` ~1119). Out of Phase 3 sale-seller scope.

## 2.3 Auth UUID seller (today)

```
resolveSessionActor → userId = auth.users.id
        ↓
Sale.soldByUserId = that UUID
        ↓
queueRemote("pending_sales", { saleId })   // sale body not in queue
        ↓
pushSaleToCloud → buildSalePushPayload
  created_by = soldByUserId   (isUuid true)
  sold_by_user_id = (not sent)
        ↓
shop_push_sale_complete
  created_by = payload or auth.uid()
  sold_by_user_id = ignored (column unused / RPC does not write it)
        ↓
SELECT * pull → rowToSale
  soldByUserId = row.created_by
        ↓
mergeSaleFromCloudPull may prefer newer remote soldByUserId
        ↓
UI filters exact-match actor.userId (UUID === UUID)  → works for that Auth user
```

## 2.4 Legacy `staff:<id>` seller (today)

```
PIN or switch-user → userId = "staff:<id>"
        ↓
Sale.soldByUserId = "staff:<id>"
        ↓
buildSalePushPayload
  created_by = ctx.userId   (owner JWT; staff: fails isUuid)
  sold_by_user_id = (not sent)
        ↓
shop_push_sale_complete writes created_by = owner
        ↓
rowToSale: soldByUserId = owner UUID
        ↓
merge may replace local "staff:<id>" with owner UUID
        ↓
Cashier filters staff:<id> === owner UUID → miss
```

**Phase 3 must leave this path’s `created_by` and filters untouched.** Only add `sold_by_user_id = NULL`.

---

# 3. Exact files and symbols affected

| File / symbol | Classification | Why |
|---------------|----------------|-----|
| Future migration **159** (not created): `shop_push_sale_complete`, `shop_push_pending_sale` | **MUST CHANGE** (SQL later) | Extra JSON keys are ignored today |
| `src/offline/cloudSync.ts` `buildSalePushPayload` | **MUST CHANGE** | Add `sold_by_user_id` beside unchanged `created_by` |
| `src/offline/cloudSync.ts` `buildPendingSalePushPayload` | **MUST CHANGE** | Same rule on pending/offline upsert |
| `src/offline/cloudSync.ts` `isUuid` | **MAY CHANGE** | Reuse as-is; do not loosen |
| `src/offline/cloudSync.ts` `rowToSale` | **MUST NOT CHANGE** in Phase 3 | Still `soldByUserId = created_by` |
| `src/offline/cloudSync.ts` `pushSaleToCloud` / `pushPendingSaleToCloud` | **MUST NOT CHANGE** | They already send the payload object |
| `src/lib/saleFinancialMerge.ts` `mergeSaleFromCloudPull` | **MUST NOT CHANGE** | Changing metadata winner would alter PIN history |
| `src/lib/sessionActor.ts` | **MUST NOT CHANGE** | |
| `src/hooks/useAuth.ts` `signInStaff` | **MUST NOT CHANGE** | |
| `usePosStore.finalizeDraftSale` seller assignment | **MUST NOT CHANGE** | Local identity source stays |
| Dashboard / filter files listed in §6 | **MUST NOT CHANGE** | Dual-write does not require them |
| `src/types.ts` `Sale` | **MAY CHANGE** | Optional comment only; do **not** add a second local seller field in Phase 3 |
| `src/lib/staffV2Phase2Foothold.test.ts` | **MUST CHANGE later** | Today asserts `cloudSync` has no `sold_by_user_id` |
| RLS / `shop_members` / invitations / PIN | **MUST NOT CHANGE** | |

No direct client `sales` insert/upsert exists. Completed and pending sales go through RPCs only (**EVIDENCE** `pushSaleToCloud`, `pushPendingSaleToCloud`).

---

# 4. Database contract findings

## 4.1 Phase 2 columns

`158` adds nullable FKs. **Unapplied** to staging/production. Phase 3 write against a DB without 158 fails (`42703` undefined column) if the RPC lists the column.

## 4.2 Current RPC unpack (**EVIDENCE** `120_sale_price_validation.sql`)

- Payload: `p_payload jsonb` → `v_sale := p_payload -> 'sale'`.
- Arbitrary extra keys on `sale` are **ignored**.
- Authorization: `auth.uid()` + `user_is_cashier_or_above(p_shop_id)`. Independent of `created_by`.
- `created_by` = `coalesce(nullif(v_sale->>'created_by','')::uuid, v_uid)`.
- `ON CONFLICT (id)` **does not update `created_by`**. First writer wins.
- `EXCEPTION WHEN OTHERS` returns `{ ok: false, error: sqlerrm }` and rolls back the function body (sale + stock not committed).

`shop_push_pending_sale` (**EVIDENCE** `129_hospitality_restaurant_billing_sync.sql`): same `created_by` coalesce; conflict also **does not** update `created_by`. Extra keys ignored.

## 4.3 Would `sold_by_user_id` in JSON work today?

**Ignored.** No reject (JSON is schemaless). **No persist.**

## 4.4 Does Phase 3 require a migration after 158?

**Yes. RECOMMENDATION:** proposed `159` only:

- `INSERT` `sold_by_user_id` using an **existence-checked** UUID (NULL if missing, empty, or not in `auth.users`).
- `ON CONFLICT` / completed-retry: `sold_by_user_id = coalesce(sales.sold_by_user_id, excluded.sold_by_user_id)` — fill once, never clobber, never overwrite `created_by`.
- Same for `shop_push_pending_sale`.
- Do **not** edit 158. Do **not** change RLS. Do **not** change `created_by` expressions.

Adding the field does **not** weaken shop authorization: `p_shop_id` + `auth.uid()` membership is unchanged.

## 4.5 FK vs `isUuid`

`isUuid` (**EVIDENCE** `cloudSync.ts` ~121) is RFC-4122 variant check only. It does **not** prove `auth.users` membership.

`sales.sold_by_user_id` FK to `auth.users(id)` **does** validate at write time **if the RPC assigns the value directly**. A stale/deleted UUID then raises, the `WHEN OTHERS` handler fires, **the entire sale (and stock apply) is rejected**.

`created_by` already has this risk when `soldByUserId` is UUID-shaped.

**RECOMMENDATION:** for the **new** column only, assign via `SELECT id FROM auth.users WHERE id = candidate`. No row → NULL. Do not fail the sale. Do not use `ctx.userId` / owner as fallback.

Invalid non-UUID strings: client omits/nulls them. RPC `::uuid` on garbage would throw and reject the sale — client must not send garbage.

---

# 5. Proposed Phase 3 write contract

```
sellerCandidate = local sale.soldByUserId

created_by:
    EXACT CURRENT BEHAVIOR
    sale.soldByUserId && isUuid(sale.soldByUserId)
        ? sale.soldByUserId
        : ctx.userId
    RPC: coalesce(payload.created_by::uuid, auth.uid())
    ON CONFLICT: do not update created_by

sold_by_user_id:
    client:
        sale.soldByUserId && isUuid(sale.soldByUserId)
            ? sale.soldByUserId
            : null
        NEVER staff:<id>
        NEVER local:<email>
        NEVER ctx.userId fallback
        NEVER shop_pos_staff lookup
        NEVER name/email match

    RPC:
        candidate = nullif(trim(v_sale->>'sold_by_user_id'), '')::uuid
        sold_by_user_id = (
          SELECT u.id FROM auth.users u WHERE u.id = candidate
        )
        -- missing key, null, or unknown UUID → NULL
        -- sale still succeeds

    ON CONFLICT / retry:
        coalesce(existing.sold_by_user_id, incoming)
```

Retries rebuild the payload from IndexedDB/`usePosStore` by `saleId` (**EVIDENCE** `cloudSync.ts` case `"sale"` / `"pending_sales"`). Offline Auth UUID on the local sale survives reconnect.

Old clients omit the key → RPC NULL → compatible.

---

# 6. Pull contract (Phase 3)

Local `Sale` has only `soldByUserId` (**EVIDENCE** `src/types.ts`). That field is overloaded (Auth UUID **or** `staff:<id>`). There is no second local seller field.

`SELECT *` will include `sold_by_user_id` after 158. `rowToSale` ignores it (**EVIDENCE** ~357).

**Phase 3 pull rule: no change.**

| Cloud state | Pull / merge |
|-------------|--------------|
| `sold_by_user_id` is a UUID | Ignored locally. `soldByUserId` still from `created_by`. |
| `sold_by_user_id` is NULL | Same as today. |
| Old rows with only `created_by` | Same as today. |
| Local row is `staff:<id>` | Keep current merge (`soldByUserId: meta.soldByUserId ?? financialBase.soldByUserId` when remote is newer). **Known PIN rewrite remains.** Phase 3 must not “fix” it. |

**Why not map `sold_by_user_id` → local `soldByUserId` now**

If cloud `sold_by` is UUID and local is `staff:<id>`, overwriting would destroy the only local PIN identity. If cloud `sold_by` is NULL and we “fall back” to `created_by`, that **is** today’s behavior. Implementing a smarter pull requires a **new** local field (`soldByAuthUserId`) and filter work — Phase 4+.

Changing `rowToSale` in Phase 3 is **not required** for dual-write correctness and **would** risk silent attribution changes.

---

# 7. Compatibility matrix

| Sale origin | Local seller | Cloud `created_by` | Cloud `sold_by_user_id` (after 159) | Expected behavior |
|-------------|--------------|--------------------|-------------------------------------|-------------------|
| Owner Auth, selling as self | Owner UUID | Owner UUID (current) | Owner UUID | Dual-write; values may be equal |
| Auth `shop_members` cashier (rare, already possible) | Their Auth UUID | Their UUID if `isUuid` | Their UUID | Dual-write; filters still match UUID |
| Legacy PIN cashier | `staff:<id>` | Owner `ctx.userId` (**unchanged**) | **NULL** | No mapping; PIN bug unchanged |
| Owner + PIN switch | `staff:<staffId>` | Owner `ctx.userId` (**unchanged**) | **NULL** | Same as PIN |
| Offline Auth sale, then reconnect | Auth UUID on local sale | Same as online Auth | Auth UUID | Queue rebuilds payload; UUID survives |
| Offline PIN sale, then reconnect | `staff:<id>` | Owner if JWT present; else no push | **NULL** | Current PIN / no-JWT behavior |
| Old pre-Phase-3 sale | whatever was stored | Existing `created_by` | NULL (never written) | Pull unchanged |
| Local-only / no Supabase | `local:…` or UUID unused | No cloud row | No cloud row | No new assumptions |
| `sessionActor` null | null | `ctx.userId` | **NULL** | No invented seller |
| Stale UUID not in `auth.users` | UUID-shaped | Current `created_by` risk (may fail) | **NULL** (existence check) | Do not substitute owner |

---

# 8. Required tests (later — do not add now)

| Test | Assert |
|------|--------|
| Auth seller dual-write | Payload `created_by` and `sold_by_user_id` both equal seller UUID |
| Owner writer = seller | Both fields equal owner UUID |
| Legacy PIN seller | `created_by` still `ctx.userId`; `sold_by_user_id` is `null`; `staff:` never in payload UUID fields |
| `created_by` freeze | Ternary unchanged vs Phase 2 snapshot |
| Pending / offline | `buildPendingSalePushPayload` same sold_by rule; retry from `saleId` only |
| Pull compatibility | `rowToSale` still uses `created_by`; `staff:` local + null `sold_by` does not become a guessed UUID |
| Invalid / stale UUID | Client does not send non-UUID; RPC existence-check → NULL; sale still `ok` if `created_by` succeeds |
| Regression | `staff:deadbeef` / `staff:<uuid>` never written to `sold_by_user_id` |
| Update Phase 2 foothold test | Allow `sold_by_user_id` in payload builders; still forbid remap / PIN / `sessionActor` edits |

---

# 9. Phase 3 implementation proposal

**Do not implement until approved.** Minimal file-by-file:

### Step 0 — Preconditions

Apply `158` on staging. Confirm columns exist. Do not apply from this audit.

### Step 1 — Migration 159 (new file only)

- Replace `shop_push_sale_complete` and `shop_push_pending_sale` with current bodies **plus** `sold_by_user_id` insert/fill-once as in §5.
- Copy latest function bodies (`120` and `129`); do not revert other RPC behavior.
- No RLS, no `created_by` edit, no `shop_members`.

### Step 2 — Client payload only

In `buildSalePushPayload` and `buildPendingSalePushPayload`:

```
sold_by_user_id: sale.soldByUserId && isUuid(sale.soldByUserId)
  ? sale.soldByUserId
  : null
```

Leave the `created_by` line untouched.

### Step 3 — Tests listed in §8

### Step 4 — Explicit non-goals

No `rowToSale` change. No filter/dashboard change. No PIN / invitation / staff linking. No `staff:` conversion.

---

# 10. STOP / approval gate

```
NO PHASE 3 CODE HAS BEEN IMPLEMENTED.
NO NEW MIGRATION HAS BEEN CREATED.
NO SQL HAS BEEN APPLIED.
NO SUPABASE DATA HAS BEEN TOUCHED.

WAITING FOR APPROVAL.
```

**INFERENCE (runtime, not proven here):** how often production cashiers are Auth `shop_members` vs PIN-only. Code allows Auth members; product onboarding does not create them yet.

**RECOMMENDATION:** Approve Phase 3 only as §9. After it ships, Phase 4 remains shop invitations — still not a PIN cutover.
