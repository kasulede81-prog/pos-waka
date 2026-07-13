# Phase 24.1B — Enterprise Real-Time Synchronization Engine

**Mode:** Enterprise implementation (synchronization only)  
**Status:** Complete  
**Builds on:** [Phase 24.0 certification](./PHASE_24_0_ENTERPRISE_PERFORMANCE_SYNCHRONIZATION_CERTIFICATION.md), [Phase 24.1A instant shell](./PHASE_24_1A_ENTERPRISE_INSTANT_SHELL_STARTUP_OPTIMIZATION.md)

---

## Objective

Transform WAKA POS synchronization from a timer-first model into an **event-driven, near real-time** engine while preserving offline-first guarantees. This phase changes **sync orchestration only** — no business logic, schema, or UI workflow changes.

**Target:** Perceived sync responsiveness **6.5 → 9.3–9.5 / 10** on healthy networks (~0.5–1 s cross-device sale visibility).

---

## Before vs. After

### Before (Phase 24.0 baseline)

```
Local commit
  → queue (IndexedDB)
  → wait debounce (500 ms native)
  → wait push gap (4 s)
  → wait interval (12 s POS / 2 min pull)
  → syncShopWithCloud (single mutex: pull blocks push)
  → merge (may suppress pull on /pos, /stock, /owner)
```

- `syncSaleImmediately()` existed but was **never called**
- Pull suppressed on operational routes
- Push and pull shared one global mutex

### After (Phase 24.1B)

```
Local commit
  → queue (IndexedDB)
  → scheduleImmediateSyncForKind (priority + coalesce)
  → immediate push scheduler (0 ms debounce, force bypass)
  → push pipeline (independent mutex)
  → ACK → scheduleIncrementalCloudPull

Parallel:
  Realtime / reconnect / foreground / sale_ack / safety_poll
  → pull pipeline (independent mutex)
  → incremental merge (checkpoints, no full refresh)
```

- Event-driven first; polling is **fallback only**
- Push never waits for pull
- Background pull runs on **all routes** except internal admin

---

## Push Pipeline Architecture

| Step | Module | Behavior |
|------|--------|----------|
| Enqueue | `syncEngine.enqueueSync` | Persists to IndexedDB, records enqueue latency, calls `scheduleImmediateSyncForKind` |
| Store bridge | `usePosStore.queueRemote` | Persists via `enqueueSync` (single hook — no duplicate immediate scheduling) |
| Route | `immediateSync.ts` | P0 immediate / P1 immediate / P2 routine; adaptive coalesce via `coalesceMsForConnection` |
| Sale fast-path | `runImmediateSaleSync` | `syncSaleImmediately` → queue drain → pull on ACK |
| Upload | `posPushScheduler.runPosPushOnlyUpload` | Push-only; no pull; gap bypass when `force: true` |
| Mutex | `globalSyncMutex.withPushSyncMutex` | Push and flush queue serialized; independent from pull |
| Retry | `syncEngine.flushSyncQueueInner` | Priority-sorted queue; existing backoff unchanged |

**Priority queues (P1):**

| Priority | Kinds |
|----------|-------|
| P0 | Sales, payments, stock, shifts, expenses, day closes |
| P1 | Customers, staff, purchases, suppliers, inventory counts |
| P2 | Settings, audit logs, analytics |

**Coalescing (P1):** Rapid edits to the same product/customer/supplier collapse into one upload after `coalesceMsForConnection(baseMs)` (80–840 ms depending on connection quality) without delaying P0 operations.

---

## Pull Pipeline Architecture

| Trigger | Priority | Module |
|---------|----------|--------|
| Supabase Realtime (`shop_activity`, `sync_health`) | 1 | `realtimeSyncPull.ts` |
| Sale push ACK | 2 | `immediateSync.scheduleImmediatePull` |
| Network reconnect | 3 | `useSyncStatus.tsx` |
| Foreground / Android resume | 4 | `useSyncStatus.tsx` + Capacitor `appStateChange` |
| Safety polling | 5 | `scheduleIncrementalCloudPull("safety_poll")` |

| Step | Module | Behavior |
|------|--------|----------|
| Schedule | `scheduleIncrementalCloudPull` | 0 ms debounce; event coalesce via `SYNC_EVENT_PULL_MIN_MS` |
| Gate | `shouldAllowCloudPull` | Respects internal-admin pause; shorter interval for events |
| Pull | `runCloudPullBundle` | Incremental pull + hospitality + staff + security pin |
| Mutex | `withPullSyncMutex("pullCloud")` | Independent from push |
| Merge | `pullCloudAndMergeIntoStore` | Checkpoint-based incremental; chunked state apply |

---

## Realtime Event Handling

Uses existing Supabase tables — **no migration**:

- `shop_activity` UPDATE → `scheduleImmediatePull("realtime", { force: true })`
- `sync_health` UPDATE → same

Channel lifecycle managed by `startRealtimeSyncPull` / `stopRealtimeSyncPull` in `SyncStatusProvider` startup.

---

## Route-Aware Synchronization (Part 5)

**Removed:** Pull suppression on `/pos`, `/stock`, `/owner`.

**Retained:** Pull/push pause only on internal admin routes (`backgroundWorkPolicy.ts`).

Remote sales and inventory now propagate in the background during checkout. Merge logic (unchanged) applies non-conflicting updates incrementally.

---

## Connection Intelligence (P1)

`syncDiagnostics.syncConnectionQuality()` classifies:

| Quality | Condition | Sync behavior |
|---------|-----------|---------------|
| `excellent` | Push ≤ 1.2 s | Fastest coalesce (0.85× base) |
| `good` | Default healthy | Standard immediate propagation |
| `slow` | Push > 6 s or pull > 8 s | 2× coalesce window |
| `reconnecting` | First 5 s after reconnect | 3× coalesce window |
| `offline` | No network | Queue only; no upload |

`markSyncReconnecting()` is invoked on connectivity restore in `useSyncStatus.tsx`. Coalesce delay adapts via `coalesceMsForConnection()` in `immediateSync.ts`.

---

## Enterprise Diagnostics (P1)

All logs use prefix **`[waka-sync]`** (dev or `localStorage.waka.sync.log = "1"`):

| Event | Fields | Source |
|-------|--------|--------|
| `enqueue_latency` | durationMs | `syncEngine.enqueueSync` |
| `push_start` / `push_end` | source, durationMs | `posPushScheduler`, `immediateSync` |
| `ack` | durationMs | `posPushScheduler` (successful upload) |
| `pull_scheduled` / `pull_start` / `pull_end` | reason, durationMs | `cloudSync`, `immediateSync` |
| `merge_end` | durationMs | `runIncrementalCloudPull` |
| `checkpoint` | durationMs | `pullCloudAndMergeIntoStore` (incremental fetch) |
| `coalesce` | kind, key | `immediateSync` |
| `realtime_event` | received / latencyMs | `realtimeSyncPull`, pull on `realtime` reason |
| `queue_depth` | depth | `enqueueSync`, `flushSyncQueueInner` |
| `retry` | kind, attempts | `flushSyncQueueInner` on failure |

**End-to-end timeline** (`readSyncDiagnosticsSnapshot().timelineMs`):

1. `commitToQueue` — local write → IndexedDB enqueue
2. `queueToUpload` — enqueue → push complete
3. `uploadToAck` — upload → server ACK
4. `ackToPull` — ACK → pull complete
5. `pullToMerge` — pull → merge complete
6. `mergeToVisible` — reserved for UI visibility hook

No credentials or business payloads are logged.

---

## Performance Measurements

Timeline stages (via `[waka-sync]` + `performanceMetrics.recordSyncDuration`):

1. Local commit → queue (`enqueue`)
2. Queue → upload start (`push_start`)
3. Upload → server ACK (`push_end`)
4. ACK → pull scheduled (`pull_scheduled` / `sale_ack`)
5. Pull latency (`pull_end`)
6. Merge latency (`merge_end`)

Native profile targets (from `syncTiming.ts`):

| Parameter | Native |
|-----------|--------|
| Push debounce bypass | 0 ms (immediate) |
| Min push gap (routine) | 800 ms |
| Event pull coalesce | 2 s |
| Safety pull interval | 15 s min |
| Reconnect delay | 100 ms |
| Android resume delay | 250 ms |

---

## Android Optimization (Part 13)

- Capacitor `appStateChange` → immediate push + forced pull on resume
- Faster reconnect/resume delays in native sync profile
- Background pull continues on POS routes (no checkout blocking)

---

## Files Changed / Added

| File | Role |
|------|------|
| `src/lib/immediateSync.ts` | Event-driven push orchestration |
| `src/lib/realtimeSyncPull.ts` | Supabase Realtime nudge |
| `src/lib/syncDiagnostics.ts` | `[waka-sync]` logging |
| `src/lib/syncQueuePriority.ts` | Priority + coalesce keys |
| `src/lib/globalSyncMutex.ts` | Split push/pull mutexes |
| `src/lib/syncTiming.ts` | Faster native cadence |
| `src/lib/backgroundWorkPolicy.ts` | Route pull policy |
| `src/lib/posPushScheduler.ts` | Immediate-first push |
| `src/offline/cloudSync.ts` | Split pipelines, incremental pull scheduler |
| `src/offline/syncEngine.ts` | Central enqueue hub + priority queue sort + retry diagnostics |
| `src/store/usePosStore.ts` | `queueRemote` → `enqueueSync` (no duplicate hooks) |
| `src/hooks/useSyncStatus.tsx` | Realtime init, event-driven lifecycle |

---

## Regression Protection (Part 14)

Verified unchanged:

- Offline-first IndexedDB queue durability
- Existing retry/backoff in `autoSync.ts`
- Conflict resolution / merge functions
- RPC payloads and business logic
- `syncSaleImmediately` now **wired** (was dead code)

---

## Remaining Optimization Opportunities

1. **Realtime table expansion** — subscribe to entity-specific channels if added server-side
2. **Pull entity fan-out** — parallel entity pulls within pull mutex (currently sequential RPCs)
3. **Diagnostics UI** — surface `readSyncDiagnosticsSnapshot()` in owner settings
4. **Cross-device ACK visibility metric** — requires server-side timestamp correlation
5. **mergeToVisible hook** — wire React commit timing for full Device A → Device B latency

---

## Verification

```bash
npm run build
npm test
```

Both must pass with no business regressions.

---

## Success Criteria Checklist

- [x] Sales sync path is immediate after local commit
- [x] Push and pull pipelines are independent
- [x] Realtime + reconnect + foreground triggers pull
- [x] POS/stock/owner routes no longer suppress pull
- [x] Priority queue prevents settings from blocking sales
- [x] Coalescing reduces redundant catalog uploads
- [x] `[waka-sync]` diagnostics expanded
- [x] Android resume triggers sync immediately
- [x] Build and tests pass
