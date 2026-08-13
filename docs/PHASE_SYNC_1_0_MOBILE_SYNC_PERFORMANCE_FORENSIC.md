# Phase SYNC-1.0 — WAKA Mobile Sync Performance & Automation Forensic Certification

**Date:** 2026-08-13  
**Mode:** READ-ONLY forensic audit — **no source, migration, deploy, or data changes**  
**Production target:** WAKA POS Web + Android + iOS / Capacitor  
**Central question:** Why did sync feel slower after recent updates, and is it still automatic, incremental, and reliable?

Live round-trip timings on a cashier device were **not measured**. Latency claims below are from code structure, not stopwatch evidence.

---

## 1. Executive verdict

### **CONDITIONAL GO**

Sync is **still automatic and still incremental** for core shop data. It did **not** regress into “download the entire shop on every cycle.”

It **did** get slower because each automatic cycle now does **more sequential work**, and several independent listeners fire **force** pulls that bypass the normal rate limit.

**Overall score: 6.2 / 10**

| Question | Answer | Confidence |
|----------|--------|------------|
| 1. Is sync actually automatic? | **Yes** — launch, resume, reconnect, sale, realtime, safety timer | CONFIRMED |
| 2. Cold launch | Disk hydrate first; UI can become usable; background push+pull after idle (~80–300ms native delay, plus auth/workspace) | CONFIRMED |
| 3. App resume | Native `App.appStateChange` **and** `visibilitychange` both schedule force push+pull | CONFIRMED |
| 4. Network returns | `useSyncStatus` reconnect effect: force push + force pull (~100ms native) | CONFIRMED |
| 5. After an offline sale | Local write + `enqueueSync` + `runImmediateSaleSync`; on ACK, **full incremental bundle** pull | CONFIRMED |
| 6. Multiple local changes | Catalog edits coalesce (~200–280ms); sales upload in parallel (3–6) | CONFIRMED |
| 7. Incremental or full download? | Incremental `updated_at` cursors after bootstrap; full only if local empty / `!bootstrapComplete` / `forceFull` | CONFIRMED |
| 8. Does one sync trigger another? | Sale ACK schedules another pull; hospitality pull also refreshes open pending sales | CONFIRMED |
| 9. Multiple workers? | Split push/pull pipelines can run together; UI `syncingRef` + `pushInFlight` + `incrementalPullQueued` | CONFIRMED |
| 10. Unnecessarily serialized? | **Yes** — ~15 entity pulls run **one after another**, then hospitality, staff, device authority, PIN | CONFIRMED |
| 11. Unnecessary Supabase queries? | `resolveShopCtx` re-resolves org/shop (2–4 queries) on every pull; empty incremental still hits every table | CONFIRMED |
| 12. Auth/session waits? | `getSession()` in `resolveShopCtx`, queue `processOne`, post-bootstrap, push gate | CONFIRMED |
| 13. Retries causing long delays? | Queue backoff 2s → 5 min, max 100 attempts. UI is **not** blocked on retries | CONFIRMED |
| 14. Missing pagination/indexes? | Pulls are paginated. Composite `(shop_id, updated_at)` indexes **not verified** in this audit | POSSIBLE |
| 15. Recent updates duplicate work? | Yes — extra entities (counts/shifts/day-close) + hospitality bundle + device authority on **every** pull | CONFIRMED |

Sync is **not** a cashier-facing manual step. Cashiers should not need Sync/Refresh for ordinary sales. Manual `flush` exists for diagnostics.

---

## 2. Actual deletion of the “full download every time” hypothesis

**FALSE as a blanket claim.** After `bootstrapComplete`, `pullShopDataFromCloud` uses per-entity cursors (`.gt("updated_at", cursor).limit(N)`).

What **is** true: an “incremental” cycle is still **expensive** because it always walks **every** entity type sequentially, even when the delta is empty.

---

## 3. Sync architecture

```text
App launch
  warmupLocalDb + (native) Network listener
        ↓
  resolveStartupSession / ensureWorkspace
        ↓
  PosDataProvider: bootstrapPosCriticalFromDisk → UI usable
        ↓ background
  bootstrap interactive/background from IndexedDB
        ↓
  scheduleBackgroundCloudSync  AND  SyncStatusProvider idle startup
        ↓
  PUSH (mutex, independent of pull)
    pendingSync sales → mapPool
    IndexedDB syncQueue → mapPool
        ↓
  PULL (mutex)
    resolveShopCtx (getSession + org/shop queries)
    ~15 entity incremental queries (serialized)
    hospitality RPC + open pending sales refresh
    staff pull + device authority + security PIN
        ↓
  merge into Zustand (persist suspended during merge)
        ↓
  incremental IndexedDB persist
```

**Local store:** IndexedDB `waka-pos-offline` (records, syncQueue, snapshot kv). **Not SQLite.** Capacitor Preferences are not the sync store. Cursors live in `localStorage`.

**No outbox/inbox tables in Postgres.** Outbox = IndexedDB `syncQueue` + Zustand `pendingSync`. Inbox = pull merge.

---

## 4. Trigger map

| Trigger | Function | What | Automatic? | Cadence (native) | Risk |
|---------|----------|------|------------|------------------|------|
| Cold launch | `PosDataProvider` disk bootstrap | Local state | Yes | Immediate | None |
| Post-bootstrap | `scheduleBackgroundCloudSync` | Pull+push or push-only | Yes | 0–5s | Overlaps startup pull |
| SyncStatus mount | `runPosPushFlush` + `scheduleImmediatePull("startup", force)` | Push + incremental bundle | Yes | ~300ms idle | Duplicate with bootstrap |
| Login / workspace | `hydrateAccountFromCloud({ forcePull: true })` | Recovery/hydrate | Yes | After workspace | Can lock pull |
| Network reconnect | `useSyncStatus` online flip | Force push+pull | Yes | ~100ms | Overlap with resume |
| Native resume | `App.appStateChange` | Force push+pull | Yes | ~250ms ×2 nested timeouts | **Double with visibility** |
| WebView visible | `visibilitychange` | Push; pull if pending | Yes | ~200ms | **Double with AppState on Capacitor** |
| Sale complete | `runImmediateSaleSync` then `scheduleImmediatePull("sale_ack", force)` | Sale upload then **full incremental bundle** | Yes | Immediate | **Heavy per sale** |
| Catalog edit | coalesced `runPosPushOnlyUpload` | Products/customers/suppliers | Yes | 280ms | Low |
| Realtime | `shop_activity` / `shops` / `sync_health` UPDATE | Force incremental bundle | Yes | Event | Chatty multi-device |
| Safety timer | `setInterval` min(20s, 8s) | Push if pending; else pull if 45s elapsed | Yes | 8s native | Extra pull |
| Queue badge | `readSyncQueue` interval | Local only | Yes | 12s | IDB read, not cloud |
| Manual | `flush` / `flushFull` | Diagnostics | No | User | Full if `flushFull` |

**SYNC CONCURRENCY: POSSIBLE DUPLICATES** (native resume + visibility; startup bootstrap + SyncStatus; sale ACK pull on top of safety/realtime). Not unbounded storms: `incrementalPullQueued` drops a second scheduled incremental pull while one runs. `force: true` **skips** `shouldAllowCloudPull` interval, so the *next* cycle after the flag clears can run immediately.

---

## 5. Push analysis

**Model:** local write first, upload in background. **CONFIRMED** offline-first for sales.

| Aspect | Behavior |
|--------|----------|
| Channels | Zustand `pendingSync` rows + IndexedDB `syncQueue` |
| Sales | Parallel `mapPool` concurrency 4 native / 5 mobile web / 6 desktop |
| Sale lines | Sequential inside one sale — **must stay serialized** |
| Queue flush | Parallel independent ops, concurrency 3 native |
| Coalesce | Product/customer/supplier ~280ms native |
| Retry | Exponential 2s…5 min, 100 attempts |
| Duplicate upload | `pushInFlight` skip `sync_busy`; sale upsert on id |
| Ordering | Sale lines and stock-after-sale must remain ordered |

Bottleneck is **not** “one mutation waits for the entire catalog.” Bottleneck after a sale is the **follow-on pull bundle**, not the upload itself.

---

## 6. Pull analysis

**Preferred delta architecture exists** (`syncCheckpoints.ts` + `.gt(updated_at)` + page limits).

**What actually runs on a routine incremental pull** (`runCloudPullBundle`):

1. Sequential: products, customers, sales (`select("*, sale_line_items(*)")`), expenses, returns, purchases, suppliers, supplier payments, debt payments, cash drawer adjustments, day drawer opens, inventory count sessions (RPC), shifts (RPC), day closes (RPC), stock movements  
2. Then sequential: `shop_pull_hospitality_state`, `refreshOpenPendingSalesFromCloud`, staff merge, `fetchDeviceAuthorityContext`, PIN hydrate, staff security flush

Empty deltas still pay **one round-trip per entity**. That is why “incremental” can still feel slow on Android/iOS WebView.

Full pull (`needsBootstrapPull`: empty products+sales+customers **or** `!bootstrapComplete`) paginates sales at 800/page and can download a large history. Truncation flag exists (`INCREMENTAL_MAX_PAGES = 40` × 500 = 20k sales cap).

Hospitality cursor `waka.hospitality.lastPull` is **not account-scoped** (unlike entity checkpoints).

---

## 7. Duplicate / concurrency

| Guard | Scope |
|-------|--------|
| `withPullSyncMutex` / `withPushSyncMutex` | Split pipelines; push ∥ pull allowed (Phase 24.1B) |
| Reentrant `depth > 0` | Nested same-pipeline calls run immediately (intentional for flush-inside-push) |
| `incrementalPullQueued` | Drops overlapping `runIncrementalCloudPull` |
| `pushInFlight` | Second POS push skipped |
| `syncingRef` | UI-layer flush/push |
| `hydrateInFlight` | Post-auth hydrate |

**CONFIRMED:** Capacitor resume fires **both** `visibilitychange` and `appStateChange`, each with `force: true` push+pull.

**LIKELY:** cold start runs `scheduleBackgroundCloudSync` **and** SyncStatus `"startup"` pull within hundreds of ms.

Mutex does **not** single-flight independent `hydrateAccountFromCloud` vs `pullCloud` if one is already in depth (reentrancy runs the nested fn). `incrementalPullQueued` covers the incremental scheduler only.

---

## 8. Auth / session chain

```text
Launch → getSession (startup)
      → workspace / shop
      → disk UI
      → each pull: getSession + resolvePrimaryOrganizationForUser
           (profile shop + shop_members + shops, sometimes a second members list)
      → each queue op: getSession again
```

Safe local POS work does **not** wait for pull. Cloud pull **does** wait for session + shop resolution every cycle. `setCachedShopId` is set but **not used to skip** those queries in `resolveShopCtx`.

Do **not** change authentication. Cache shop context for sync only.

---

## 9. Database / query notes

| Dataset | Incremental? | Cursor | Pagination | `select('*')` | Notes |
|---------|--------------|--------|------------|---------------|--------|
| products | Yes | `updated_at` | 500 × 40 | Yes | |
| customers | Yes | `updated_at` | 500 × 40 | Yes | |
| sales | Yes | `updated_at` | 500 × 40 | Nested line items | Heaviest payload |
| expenses | Yes | `updated_at` | 200 | | |
| returns / purchases / suppliers / payments / debts | Yes | `updated_at` or `created_at` | 500 | | Added over time |
| drawer opens / adjustments | Yes | `updated_at` | | | Multi-device |
| inventory counts / shifts / day closes | Yes via RPC | since | | | **04268a0** (2026-06-20) |
| stock movements | Yes | `updated_at` | | | |
| hospitality | RPC since | localStorage | one RPC | | Plus extra sales refresh |
| staff | Separate pull | | | | Every bundle |
| settings / org / shop row | Not a full table dump | | | | Shop ctx queries repeat |
| Vision / Ask WAKA | **Not in POS sync pull** | | | | NOT FOUND as sync payload |

Missing `(shop_id, updated_at)` indexes: **POSSIBLE**, not verified against production `pg_indexes`.

---

## 10. Local persistence

- Incremental persist diffs Zustand → `putEntitiesBatch` (not wipe/reload).
- Cloud merge suspends persist to avoid write storms.
- Queue badge polling reads the whole `syncQueue` every 12s on native — P3.
- No evidence of per-row React commit for each remote row during merge (single store updates after pull). **LIKELY** acceptable; not profiled.

---

## 11. Automatic sync / offline-first

**CONFIRMED desired cashier path:**

```text
offline sale → local save → keep selling
network up → automatic push (reconnect + pending timer)
```

Manual Sync is diagnostics (`flush`), not required for the happy path.

Recovery lock (`isCloudRecoveryLockActive`) **blocks** pull/push until recovery finishes — correct for integrity, can delay first cloud reconcile on empty/fresh devices.

---

## 12. Recent regression (code-supported, not stopwatch)

```text
Before (~pre-04268a0)
  incremental: products, customers, sales, and a smaller set
        ↓
04268a0 (2026-06-20) multi-device counts, shifts, day closes
        ↓
hospitality pull bundled into every runCloudPullBundle
        ↓
device authority + PIN + staff merge on every pull
        ↓
sale_ack / resume / startup use force:true (skip 15s native min interval)
        ↓
each automatic event pays ~15 sequential table/RPC round-trips
        + hospitality RPC + extra queries
```

`fb2decd` added mutex reentrancy and partial-pull safety (integrity, not speed).  
`e52662b` added pagination helpers and large-shop recovery.  
`617cd79` restored automatic cloud sync.  
Vision / Ask WAKA / account-deletion **do not** appear on the POS incremental pull path.

Causation of “feels slower”: **LIKELY** the growing **per-cycle sequential query set** + **force pulls on high-frequency events**, not a return to full-table replace.

---

## 13. Performance budgets (targets, not SLAs)

| Event | Budget |
|-------|--------|
| UI usable from local IndexedDB | Immediate / < 1s on a warm WebView |
| Background sync start | Shortly after paint (already ~300ms native idle) |
| Incremental pull with empty deltas | Should be **a few cheap requests**, not 15+ serial round-trips. Today: **likely several seconds** on mobile networks |
| Sale local save | Immediate (already) |
| Sale upload | Background; parallel with other sales |
| Network return | Automatic; no button |

Do not promise sub-second cloud round-trips on 2G.

---

## 14. Android + iOS

Shared architecture (Capacitor WebView). Native profile is **intentionally slower** (8s push poll, 15s timer pull, 45s full-cycle floor) for battery. That is not a bug.

**CONFIRMED mobile-specific cost:** `visibilitychange` + `App.appStateChange` both fire on foreground.

Background OS execution is limited; WAKA relies on **foreground/resume + reconnect**, not true iOS/Android background fetch. That is acceptable if resume sync is cheap.

---

## 15. Integrity (must remain serialized)

- Sale header + line items for one sale  
- Stock movements derived from a sale  
- Idempotent upsert on sale/product ids  
- RLS shop/org isolation (`shop_id` filters)  
- Recovery lock vs live POS  
- Conflict/tombstone handling for products/sales  

Do **not** parallelize those. **Do** parallelize independent entity incremental pulls (products ∥ customers ∥ expenses) after shop context is resolved.

---

## 16. Scorecard /10

| Area | Score |
|------|------:|
| Startup speed | 7 |
| Pull speed | 4 |
| Push speed | 7 |
| Incremental sync | 7 |
| Queue architecture | 8 |
| Duplicate prevention | 5 |
| Offline reliability | 8 |
| Automatic sync | 8 |
| Network recovery | 8 |
| Database efficiency | 4 |
| Local persistence | 7 |
| UI responsiveness | 7 |
| Android readiness | 6 |
| iOS readiness | 6 |
| **Overall** | **6.2** |

---

## 17. Findings

### P1-1 — Incremental pull is a sequential 15-entity tour  
**CONFIRMED**  
**File:** `src/offline/cloudSync.ts` `pullShopDataFromCloud` / `runCloudPullBundle`  
Every automatic pull (including empty delta) awaits products then customers then sales … then hospitality/staff/authority.  
**Why slow:** mobile RTT × ~15–20.  
**Fix (SYNC-1.1):** skip entities with fresh cursors and no realtime hint; parallelize independent pulls; don’t attach hospitality/staff/authority to sale-ACK.

### P1-2 — `force: true` after every sale  
**CONFIRMED**  
**File:** `src/lib/immediateSync.ts` `runImmediateSaleSync`  
Upload success schedules `scheduleImmediatePull("sale_ack", { force: true })`, bypassing native 15s / event 2s floors.  
**Fix:** sale ACK should pull **sales (+ stock)** only, or rely on realtime; keep bundle for resume/reconnect.

### P1-3 — Native resume double-fires  
**CONFIRMED**  
**File:** `src/hooks/useSyncStatus.tsx` visibility + `appStateChange`  
Both force push+pull within ~250ms.  
**Fix:** single foreground trigger on native (AppState only, or shared debounce key).

### P1-4 — Shop/session re-resolved every pull  
**CONFIRMED**  
**File:** `resolveShopCtx` in `cloudSync.ts` + `resolvePrimaryOrganizationForUser`  
**Fix:** reuse `getCachedShopId()` for the sync tick; refresh on login/shop switch only.

### P2-1 — Growing entity set since 04268a0  
**CONFIRMED**  
Counts, shifts, day closes, drawer, hospitality bolted onto the **same** bundle.

### P2-2 — Nested sale_line_items on incremental sales  
**CONFIRMED**  
`.select("*, sale_line_items(*)")` — correct for integrity, heavy on catch-up.

### P2-3 — Mutex reentrancy vs single-flight  
**CONFIRMED in tests** (`globalSyncMutex.test.ts` nested allowed).  
Overlapping hydrate + pull can run nested rather than queued.

### P2-4 — Hospitality cursor not account-scoped  
**CONFIRMED** `waka.hospitality.lastPull`

### P3-1 — Native timing profile is conservative  
**CONFIRMED** `syncTiming.ts` — by design.

### P3-2 — Queue poll reads all ops every 12s  
**CONFIRMED** `pendingUploadStats` → `readSyncQueue()`

**P0:** none confirmed (no evidence that automatic sync duplicates sales if upsert/id holds). Duplicate-sale **risk** if two push workers uploaded the same pending sale without upsert — current path uses in-flight skip + id upsert. **LIKELY safe.**

---

## 18. Exact files

| Role | Path | Symbols |
|------|------|---------|
| Orchestrator | `src/hooks/useSyncStatus.tsx` | `useSyncStatusEngine` |
| Immediate | `src/lib/immediateSync.ts` | `runImmediateSaleSync`, `scheduleImmediatePull` |
| Push scheduler | `src/lib/posPushScheduler.ts` | `runPosPushOnlyUpload` |
| Core pull/push | `src/offline/cloudSync.ts` | `pullShopDataFromCloud`, `runCloudPullBundle`, `resolveShopCtx` |
| Queue | `src/offline/syncEngine.ts` | `enqueueSync`, `flushSyncQueue` |
| Mutex | `src/lib/globalSyncMutex.ts` | `withPullSyncMutex`, `withPushSyncMutex` |
| Cursors | `src/lib/syncCheckpoints.ts` | `needsBootstrapPull` |
| Timing | `src/lib/syncTiming.ts` | native profile |
| Realtime | `src/lib/realtimeSyncPull.ts` | `startRealtimeSyncPull` |
| Hydrate | `src/lib/postAuthCloudHydrate.ts` | `hydrateAccountFromCloud` |
| Hospitality | `src/offline/hospitalityCloudSync.ts` | `pullHospitalityStateFromCloud` |
| Disk boot | `src/providers/PosDataProvider.tsx` | `runBoot` |
| IndexedDB | `src/offline/localDb.ts` / `entityStore.ts` | |

---

## 19. Recommended next phase

### Phase SYNC-1.1 — Automatic Incremental Sync Performance Repair

Scope **only**:

1. Deduplicate native resume (one foreground sync).  
2. Keep `incrementalPullQueued`; add a **reason-scoped** pull (sale → sales/stock only).  
3. Do not `force` the full bundle on `sale_ack`.  
4. Parallelize independent incremental entity pulls after one `resolveShopCtx`.  
5. Cache shop context for the sync tick.  
6. Keep sale-line ordering and upsert idempotency.  
7. Leave recovery lock, RLS, and auth model unchanged.  
8. Verify Android + iOS resume/reconnect with empty-delta timing.

Do **not** rebuild POS, checkout, or RLS.

---

## 20. Cursor-ready SYNC-1.1 prompt

```text
# Phase SYNC-1.1 — Automatic Incremental Sync Performance Repair

Mode: scoped implementation. Do NOT rebuild POS, checkout, inventory math,
payments, auth, or RLS.

Prerequisite: SYNC-1.0 CONDITIONAL GO.

Goal: keep sync automatic and offline-first, but make each cycle cheap.

CONFIRMED defects to fix:
1. runCloudPullBundle sequentially pulls ~15 entities then hospitality/staff/
   device authority on every incremental pull, including empty deltas.
2. runImmediateSaleSync schedules scheduleImmediatePull("sale_ack", { force: true })
   which bypasses native rate limits and runs the full bundle after every sale.
3. useSyncStatus fires both visibilitychange and Capacitor appStateChange on
   native resume (duplicate force push+pull).
4. resolveShopCtx calls getSession + resolvePrimaryOrganizationForUser on every
   pull even though setCachedShopId exists.

Required:
- Single-flight incremental pull (keep incrementalPullQueued; do not remove
  push/pull split mutex).
- Reason-scoped pulls: sale_ack → sales + stock only; resume/reconnect/startup
  → full incremental bundle.
- Parallelize independent entity incremental queries after one shop ctx.
- Reuse cached shop id during a sync tick; refresh on login/shop switch.
- One native foreground trigger.
- Preserve: local-first sale write, automatic reconnect upload, sale line
  ordering, upsert idempotency, recovery lock, bootstrap full pull when
  localEmpty || !bootstrapComplete.

Do not: change authentication, weaken RLS, or download full tables on every
sync.

Verify with focused tests + Android/iOS resume/reconnect empty-delta checks.
Do not claim production GO without device timing.
```

---

## SYNC AUDIT VERDICT

**CONDITIONAL GO**

Automatic incremental sync **exists** and cashiers **should not** need a Sync button for ordinary work. It feels slow because **recent multi-device/hospitality/staff/device work was bolted onto every pull**, and **force pulls** after sales and native resume skip the rate limiter.

**Production live latency: NOT VERIFIED.**  
**Full-table-every-time regression: NOT FOUND.**  
**Repeated large sequential incremental tours: CONFIRMED.**
