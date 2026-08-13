# Phase SYNC-1.1-R1 — Stuck Sale Upload Forensic Certification

**Date:** 2026-08-13  
**Mode:** READ-ONLY forensic audit — **no source, migration, or deploy changes**  
**Production:** `pos.waka.ug` / `ljaedextsenbkxzzgxcg`  
**Account:** kasule.de81@gmail.com (owner UI: kasule Denis)  
**Device:** iPhone Safari (mobile web at `pos.waka.ug`, not Capacitor native)  
**App version on device:** 1.0.12  

Screenshots: 13 Aug 18:47–18:48 Africa/Kampala. SYNC-1.1 commit `184e898` was created later the same day (~09:12 PDT) and **was not on this device**.

---

## SYNC-1.1-R1 STUCK SALE FORENSIC RESULT

### Exact sales

UI shows 8-character prefixes (`SyncHealthCard` does `e.id.slice(0, 8)`). Production rows:

| Prefix | Full id | Cloud status | payment_status | total_ugx | created_at (UTC) | updated_at (UTC) | completed_at |
|--------|---------|--------------|----------------|-----------|------------------|------------------|--------------|
| `fa5093c8` | `fa5093c8-4179-4aaa-b774-c9416c1569c5` | **cancelled** | pending | 1000 | 2026-08-10 23:46:25 | 2026-08-11 00:50:20 | null |
| `54477db2` | `54477db2-3473-47e3-8698-10230a2f7463` | **cancelled** | pending | 2000 | 2026-08-11 00:14:35 | 2026-08-11 00:50:18 | null |

Shop: `1a110d2e-d957-4c6e-a936-8af86403a836`.

These are **not missing from the cloud**. They are **already-cancelled hospitality/pending drafts**. Local still treats them as unsynced.

### Queue state

CONFIRMED from UI + code:

- Zustand `sale.pendingSync === true` (unsynced count 2, “2 waiting to upload”).
- IndexedDB `syncQueue` also has 2 sale-kind ops (breakdown Sales 2 / Stock 0 / Returns 0 / Expenses 0).
- `lastSyncError` is set (the red list is `computeSyncSalesStats().errors`, which only includes sales with `lastSyncError`).
- `queueHealth === "backing_off"` (“Waiting before retry”).

Device IndexedDB bytes were **not** read. Error string on the sale is inferred from the cloud+RPC path below.

### Retry state

IndexedDB queue backoff (`src/lib/autoSync.ts`):

| attempts | delay |
|----------|--------|
| 0 | immediate |
| 1 | 4s |
| 2 | 8s |
| … | doubles |
| 8+ | **5 minutes cap** |
| 100+ | op is **not removed**; retries continue every 5 min; attempts stop incrementing |

“Run sync now” (`sync.flush` → `forcePending: true`) **only** bypasses the UI min-interval. It does **not** reset `lastAttemptAt` / `attempts`. `flushSyncQueueInner` still skips ops that fail `shouldRetrySyncOp`.

The **pendingSync** path (`pushAllPendingToCloud`) has **no backoff**. Manual sync still calls it.

### Upload attempt

**LIKELY attempted, CONFIRMED failing.**

“Run sync now” completed with `lastIssueCode: "partial"` (“Some items still uploading”), not the 55s timeout (`error`). That means `syncShopWithCloud` finished and `push.fail > 0` or `queueFailed > 0`.

### Supabase response

CONFIRMED cloud rows exist as `cancelled`.

If local status is `cancelled` (normal after `cancelPendingSale`):

```text
pushSaleRowToCloud
  → pushCancelPendingSaleToCloud
  → RPC shop_cancel_pending_sale
```

That RPC only updates rows with `status = 'draft'`. Already-cancelled rows return:

```text
{ ok: false, error: "not_found_or_not_draft" }
```

Client then:

```text
markSaleSyncState(id, false, "not_found_or_not_draft")
→ pendingSync stays true
→ lastSyncError = "not_found_or_not_draft"
→ retry forever
```

This is **CONFIRMED in code** (`supabase/migrations/071_pending_sales.sql` + `pushCancelPendingSaleToCloud`). Device error string was not displayed in the screenshot (UI hides it).

If local status were still `pending`, `shop_push_pending_sale` would set cloud `status = 'draft'` and return `ok: true`, which would **clear** pendingSync. The sales would not stay stuck. Therefore local status is **LIKELY `cancelled`**.

### ACK state

Cancel already succeeded on the server (11 Aug ~00:50 UTC). Local ACK never cleared `pendingSync`. Subsequent cancel uploads are rejected as not-draft.

### Local state

- IndexedDB `waka-pos-offline` entity `sale` + Zustand `sales[]`
- `pendingSync: true`
- `lastSyncError` set
- Matching `syncQueue` ops (`pending_sales` / `pending_cancel`)

### Root cause

**L. Multiple causes, primary H.**

| Class | Role |
|-------|------|
| **H. ACK / idempotency** | Primary. `shop_cancel_pending_sale` is not idempotent for already-cancelled sales. |
| **C. Permanent failure loop** | Local will never ACK; 100-attempt cap does not drop the sale. |
| **B. Retry/backoff** | Explains “Waiting before retry”; does not by itself block `pushAllPendingToCloud`. |
| **D. Upload request failure** | RPC returns `ok: false` on every cancel retry. |
| **J. UI** | Shows “Sale needs upload” without the error `not_found_or_not_draft`. |
| **K. SYNC-1.1** | **NO.** |

### Is SYNC-1.1 responsible?

**NO**

Evidence:

1. Screenshots ~18:47 Kampala, 13 Aug — before commit `184e898`.
2. Device still on 1.0.12; SYNC-1.1 was not deployed as a separate release.
3. SYNC-1.1 only removed `force: true` from the **sale ACK pull**. `pushSaleRowToCloud`, `flushSyncQueueInner`, `pushAllPendingToCloud`, and cancel RPC are unchanged.

### Does the current architecture guarantee eventual upload?

**NO** — not for an already-cancelled pending sale. The uploader retries a terminal cloud state that the cancel RPC will never accept.

Completed-sale idempotency (`shop_push_sale_complete` + `already_completed` / stock skip) is separate and looks sound. **Cancel is the broken path.**

### Can “Run sync now” recover them?

**NO.** It retries the same cancel RPC. It does not treat already-cancelled as success. It does not reset queue backoff. **Do not use “Download everything again”** — that is a pull.

---

## 1. Where the UI gets those IDs

| Copy | Source |
|------|--------|
| `Sale needs upload · 54477db2` | `src/components/SyncHealthCard.tsx` — `computeSyncSalesStats(sales).errors`, `e.id.slice(0, 8)` |
| `2 waiting to upload` | same card — `unsyncedCount` (`pendingSync`) |
| Sales 2 / Stock 0 / … | `useSyncStatus.pendingBreakdown` from IndexedDB `syncQueue` |
| Waiting before retry | `health.queueHealth === "backing_off"` ← `deriveQueueHealth` |
| Run sync now | `sync.flush()` → `runFlush({ pull: true, forcePending: true })` |
| Download everything again | `sync.flushFull()` — **pull**, not the fix |

---

## 2. Upload pipeline (exact functions)

```text
checkout / cancelPendingSale
  → usePosStore (pendingSync: true)
  → putEntity("sale") IndexedDB
  → queueRemote("pending_sales", { saleId, kind: "pending_cancel" })
  → enqueueSync → IDB syncQueue
  → scheduleImmediateSyncForKind
  → runImmediateSaleSync / runPosPushOnlyUpload
  → pushShopPendingToCloud
       → pushAllPendingToCloud  (all pendingSync sales, no backoff)
       → flushSyncQueueInner    (respects backoff)
            → processCloudSyncOperation
            → pushSaleRowToCloud
                 pending    → shop_push_pending_sale
                 cancelled  → shop_cancel_pending_sale   ← these two
                 completed  → shop_push_sale_complete
  → ACK: markSaleSyncState(id, true) only if RPC ok:true
```

---

## 3. Answers A–I

| # | Answer | Confidence |
|---|--------|------------|
| A. Picked up by uploader? | Yes — pendingSync list + queue Sales 2 | CONFIRMED |
| B. Request sent? | Yes on Run sync now (partial result) | LIKELY |
| C. Response? | Cancel RPC `not_found_or_not_draft` (cloud already cancelled) | CONFIRMED path / LIKELY exact error |
| D. Selection block? | Queue backoff can skip IDB ops; pendingSync path still runs | CONFIRMED |
| E. Legitimate backoff? | Yes, after failed queue attempts, cap 5 min | CONFIRMED |
| F. retryAt stuck forever? | No hard future timestamp; 5 min cap. Cancel failure never succeeds. | CONFIRMED |
| G. retryCount ≥ 100? | Possible after 2 days; even then ops remain and retry every 5 min | POSSIBLE |
| H. Dead-letter? | No true dead-letter; infinite fail loop | CONFIRMED |
| I. UI “waiting” vs failed? | Both: waiting count is pendingSync; backing_off is queue | CONFIRMED |

---

## 4. Dual queues

A sale **can** live in both. Checkout writes `pendingSync` **and** enqueues `pending_sales`. Cancel does the same with `kind: "pending_cancel"`.

Stuck pattern here is **not** “queue missing.” It is **both present, upload rejected**.

---

## 5. Trigger map (these two cancelled sales)

| Trigger | Push pending sales? | Can recover these 2? |
|---------|---------------------|----------------------|
| App launch | Yes (`force` push) | No — same cancel RPC |
| Resume / visibility | Yes if pending | No |
| Reconnect | Yes, force | No |
| Sale ACK | N/A (these never ACK) | No |
| Safety timer | Yes, no force, 8s native / 6s mobile web | No |
| Run sync now | Yes + pull | **No** |
| Download everything again | Pull | **No** (wrong tool) |

---

## 6. Can a locally committed **completed** sale become permanently stuck?

For **completed** sales: eventual upload is **LIKELY** (idempotent complete RPC).  

For **cancelled pending** sales: **YES, permanently stuck** once the cloud is already cancelled. These two records prove it.

---

## Recommended SYNC-1.1-R2 repair

**Do not implement in this audit.**

Minimal, sale-integrity-safe:

1. **`shop_cancel_pending_sale`** (`supabase/migrations/071_pending_sales.sql`): if the row is already `cancelled` for this shop, return `{ ok: true }` (idempotent ACK). Do not require `status = 'draft'`.
2. **`pushCancelPendingSaleToCloud`** (`src/offline/cloudSync.ts`): treat `not_found_or_not_draft` as success when the sale is locally cancelled (defense in depth if the RPC is not migrated yet).
3. **Do not** reopen cancelled cloud sales via `shop_push_pending_sale` `status = 'draft'` on conflict.
4. Tests: already-cancelled cancel upload → `pendingSync` cleared, queue op removed; completed-sale upload unchanged.
5. After repair, **Run sync now** (or the next automatic push) should clear these two without “Download everything again.”

Do not redesign POS checkout. Do not use full pull as the fix.

---

## SYNC-1.1 upload-path verdict

**NO-GO for sale delivery** (cancel ACK).  

SYNC-1.1 performance repair remains valid for **pull cost**. It does **not** certify that every local sale reaches Supabase.
