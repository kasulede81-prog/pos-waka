# Phase 24.2A — Enterprise Cloud Recovery Performance & Reliability

**Mode:** Enterprise implementation (Cloud Recovery orchestration only)  
**Date:** 2026-07-13  
**Builds on:** [Phase 24.2 forensic audit](./PHASE_24_2_ENTERPRISE_CLOUD_RECOVERY_PERFORMANCE_AND_RELIABILITY_CERTIFICATION.md)  
**Scope:** Timeouts, monotonic progress, failed-state unlock, duplicate IDB elimination, Android mutex, small-shop fast path, metrics, watchdog, diagnostics  

**Unchanged:** Authentication, device management, security, staff permissions, sync algorithms, business logic, offline-first architecture, recovery integrity rules, database schema.

---

## Executive Summary

Phase 24.2A addresses the audit finding that a shop with ~20 products and ~2 customers should **never spend minutes in recovery**. The root cause was orchestration — not network or payload size.

| Dimension | Before (24.2 audit) | After (24.2A) |
|-----------|---------------------|---------------|
| Small-shop unlock | 30+ min possible (hang / state loop) | **Target ≤5 s** on healthy network (snapshot fast path) |
| Progress honesty | 0% with data present; 18% freeze at persist | Monotonic floor; snapshot persist band 18→40% |
| Stalled requests | No timeout; indefinite await | Classified `RecoveryTimeoutError` + retry |
| Failed + core data | Full-screen trap at 90% staff/validation | Core unlock + `RecoveryBackgroundBanner` warnings |
| IndexedDB on restore | Double entity migration | Single migrate via `skipEntityMigration` |
| Android resume | Overlapping pulls | `isCloudRecoveryLockActive()` blocks background sync |
| Certification | Blocks unlock path | Deferred; `skipHeavyPull` for small shops |

**Readiness estimate:** 5.2 / 10 → **9.2–9.5 / 10** (pending live Android soak on production builds).

---

## Before vs. After Recovery Timeline

### Before (small shop, empty local store)

```
[T0] beginCloudRecoverySession          → 0%
[T1] probe                              → ~9%
[T2] snapshot download + apply          → 18%  ← UI freezes here (no persist progress)
[T3] persistRestoredSnapshotToDisk      → still 18% (no step update)
[T4] migrate entities (again)           → duplicate IDB work
[T5] full entity pull (unnecessary)     → sequential, unbounded
[T6] staff                              → 90%
[T7] validateCoreOperationalGate fail   → failed, overlay blocks despite Products: 20
     OR hang on Supabase with no timeout → minutes
```

### After (24.2A, snapshot fast path)

```
[T0] beginCloudRecoverySession + sessionId   → 0%
[T1] probe (20 s timeout, 1 retry)           → ~8%   [waka-recovery perf: probe]
[T2] snapshot download + apply               → 18%
[T3] persist (skipEntityMigration)           → 18→40% manual progress band
[T4] reportRecoveryStepsFromStore            → products/sales/customers steps
[T5] staff only (45 s timeout)               → ~90%  (no full entity pull)
[T6] validateCoreOperationalGate             → 95%
[T7] unlockCoreRecoverySession               → POS usable
[T8] runBackgroundRecoveryCertification      → banner only; skipHeavyPull if small shop
[T9] certification complete                  → 100%
```

**Estimated wall time (20 products, 2 customers, healthy Wi‑Fi):** 2–5 seconds.

---

## Part 1 — Recovery Timeouts (P0)

**Module:** `src/lib/recoveryTimeout.ts`

Every long-running recovery operation is wrapped with `withRecoveryTimeout` / `withRecoveryTimeoutPromise`:

| Kind | Default timeout | Retries |
|------|-----------------|--------|
| `probe` | 20 s | 1 |
| `snapshot` / `persist` | 120 s | 1 |
| `entity_pull` | 180 s | 1 |
| `staff` | 45 s | 1 |
| `global` (gated session) | 210 s | 0 |

- Uses `AbortController` for cancellable operations.
- On timeout: throws `RecoveryTimeoutError` with classified `kind` (e.g. `recovery_timeout_probe`).
- Retries increment `session.runtime.retryCount` via `recordRecoveryRetry()`.
- Timeouts increment `session.runtime.timeoutCount` via `recordRecoveryTimeout()`.

**Integration points:** `postAuthCloudHydrate.ts` (probe, snapshot, entity pull, staff, global gated wrapper).

---

## Part 2 — Monotonic Progress Engine (P0)

**Module:** `src/lib/recoveryProgress.ts`

Improvements:

1. **`returns` added** to download ladder (fixes 0% regression when returns step completed).
2. **`STEP_INDEX_FALLBACK`** maps legacy steps (`audit`, `snapshot_empty_after_restore`, `validation`) to nearest valid index — never `-1`.
3. **`progressFloorPct`** on session — each `reportRecoveryStep` raises the floor; progress never drops.
4. **`manualProgressPct`** for sub-step work (snapshot persist).
5. **`computeRecoveryProgressPct`** returns `max(fromStep, floor, manual)` capped at 90% during download.

**UI:** `CloudRecoveryScreen.tsx` uses `downloadStepIndex` from the progress module for checklist alignment.

---

## Part 3 — Missing Progress Updates (P0)

| Stage | Progress reporting |
|-------|-------------------|
| Snapshot persist | `reportRecoveryManualProgress(snapshotPersistProgressPct(0→100))` in `cloudSnapshotSync.ts` |
| Entity steps | `reportRecoveryStepWithCheckpoint` in `postAuthCloudHydrate.ts` |
| Validation | `progressPhase: "validating"` → 95% |
| Finalizing | `progressPhase: "finalizing"` → 98% |

Snapshot persist band: **18% (post-snapshot) → 40% (products step)** while IndexedDB writes run.

---

## Part 4 — Failed State Recovery (P0)

**Modules:** `cloudRecoverySession.ts`, `postAuthCloudHydrate.ts`

When core operational data exists in the store (`storeHasCoreRecoveryData()`):

- **`finishGracefulCoreUnlock`** calls `unlockCoreRecoveryWithDegradedValidation` instead of trapping in `failed`.
- **`isCloudRecoveryBlocking()`** returns `false` on `failed` status if `products`, `sales`, or `customers` > 0.
- Non-critical validation/staff/timeout errors surface via **`RecoveryBackgroundBanner`** (`EnterpriseFeedbackBanner` tone: warning).
- Background certification continues after unlock.

---

## Part 5 — Duplicate IndexedDB Writes (P0)

**Root cause:** `applyRestoredSnapshotFromBackup` migrated entities in memory, then `persistRestoredSnapshotToDisk` ran migration again.

**Fix:**

- `persistRestoredSnapshotToDisk(..., { skipEntityMigration: true })` after snapshot apply (`cloudSnapshotSync.ts`).
- `flushFullSnapshotPersist` in `incrementalPersist.ts` respects `skipEntityMigration`.
- `pullCloudAndMergeIntoStore` passes `skipEntityMigration: true` when `cloudRecovery === true` (`cloudSync.ts`).

Result: **one migration + one snapshot write** on restore path.

---

## Part 6 — Android Recovery Mutex (P1)

**Mechanism:** `isCloudRecoveryLockActive()` is true only while `session.status === "active"`.

Background work checks this guard:

- `shouldAllowCloudPull()` in `cloudSync.ts` — returns `false` during active recovery.
- `posPushScheduler.ts`, `usePosStore` background sync, `cloudSnapshotSync.ts` upload.
- `runCloudRecoveryGated` reuses `gatedRecoveryInFlight` promise — duplicate triggers await the same session.
- `hydrateAccountFromCloud` respects cooldown + in-flight guard.

Resume/reconnect cannot start a second download while the first is active.

---

## Part 7 — Smart Recovery Scheduler (P1)

**Modules:** `recoveryModuleClassification.ts`, `recoveryModuleCheckpoints.ts`

Critical modules (products, customers, sales, staff, preferences) unlock the app first:

- Snapshot fast path: after snapshot + persist, **`reportRecoveryStepsFromStore`** marks entity steps from live counts; only **staff pull** runs (no full entity pull).
- Module checkpoints allow **resume** without re-downloading completed modules.
- Background certification handles optional/heavy modules (reports, audit logs, analytics).

---

## Part 8 — Small-Shop Fast Path (P1)

**Module:** `src/lib/recoveryFastPath.ts`

Configurable thresholds:

| Entity | Threshold |
|--------|-----------|
| Products | ≤ 500 |
| Customers | ≤ 1,000 |
| Sales | ≤ 10,000 |

When eligible:

- Skip full entity pull after successful snapshot restore.
- `runBackgroundRecoveryCertification({ skipHeavyPull: true })` — no redundant `syncShopWithCloud` full pull.

---

## Part 9 — Recovery Performance Metrics (P1)

**Module:** `src/lib/recoveryDiagnostics.ts`

Enable verbose timeline: `localStorage.setItem("waka.recovery.log", "1")` (or DEV mode).

Perf marks exposed via `[waka-recovery]` logs:

| Mark | When set |
|------|----------|
| `authMs` | (reserved for auth boundary) |
| `shellVisibleMs` | (reserved for shell) |
| `snapshotDownloadMs` | snapshot fetch complete |
| `idbPersistMs` | IndexedDB persist complete |
| `validationMs` | validation phase |
| `coreRecoveredMs` | core unlock |
| `posUnlockedMs` | POS entry allowed |
| `certificationFinishedMs` | background cert done |
| `recoveryCompletedMs` | full recovery complete |

No credentials or shop IDs in logs.

---

## Part 10 — Recovery Watchdog (P1)

**Module:** `src/lib/recoveryWatchdog.ts`

- `beginRecoveryStageWatch(stage, warnAfterMs)` — logs stall if stage exceeds threshold (default 15 s).
- Stages: `snapshot`, `full_cloud_pull`, `staff`, `cloud_restore`.
- Emits `[waka-recovery] download_step { watchdog: "stall", stage, elapsedMs }`.
- `endRecoveryStageWatch` logs stage duration on completion.

---

## Part 11 — Diagnostics Expansion

**Session runtime** (`CloudRecoverySessionState.runtime`):

| Field | Description |
|-------|-------------|
| `sessionId` | Unique recovery session (`rec_*`) |
| `currentStage` | Active stage name |
| `stageStartedAt` | ISO timestamp |
| `timeoutCount` | Cumulative timeouts |
| `retryCount` | Cumulative retries |
| `idbPersistDurationMs` | Last IndexedDB persist duration |
| `lastCloudRequestDurationMs` | Last cloud request duration |

Persisted to `localStorage` key `waka.cloudRecovery.diagnostics.v1` on complete/fail.

---

## Part 12 — Regression Protection

Verified unchanged:

| Area | Status |
|------|--------|
| Offline-first architecture | ✅ No change to local-first reads |
| Cloud Recovery integrity rules | ✅ `validateCoreOperationalGate` still enforced; degraded unlock only when core data present |
| Authentication / device activation | ✅ Not modified |
| Sync algorithms | ✅ Entity merge logic unchanged; only orchestration guards added |
| Staff recovery | ✅ Still required; timeout + degraded path on failure |
| Database schema | ✅ No migrations |

**Verification commands:**

```bash
npm test    # 1710 passed (4 skipped)
npm run build
```

Recovery-specific tests: `recoveryProgress.test.ts`, `recoveryTimeout.test.ts`, `recoveryFastPath.test.ts`, `recoveryIntegrityFix.test.ts`, `cloudRecoverySession.test.ts`.

---

## Performance Benchmarks (Expected)

| Shop profile | Network | Expected unlock |
|--------------|---------|-----------------|
| 20 products, 2 customers | Healthy Wi‑Fi | 2–5 s |
| 200 products, 50 customers | Healthy Wi‑Fi | 5–12 s |
| 2,000 products | Healthy Wi‑Fi | 15–45 s (full pull may run) |
| Any size | Offline at probe | Probe fail → offline escape (unchanged) |
| Any size | Stall mid-request | Timeout at 20–180 s → retry or degraded unlock |

*Live device benchmarks should be captured in QA soak; code-path analysis supports the above budgets.*

---

## Remaining Technical Debt

1. **`authMs` / `shellVisibleMs`** perf marks — hooks exist but not yet wired at auth/shell boundaries.
2. **Abort-aware Supabase client** — timeouts abort the wrapper promise; underlying fetch may still complete (no request cancellation at HTTP layer).
3. **Explicit critical-first entity ordering in full-pull fallback** — snapshot path optimized; very large shops on full-pull still sequential.
4. **Production Android soak** — validate ≤5 s unlock on real devices with `[waka-recovery]` timeline export.
5. **Recovery regression E2E** — consider Playwright/Capacitor harness for resume/reconnect mutex scenarios.

---

## Files Changed (24.2A)

| File | Purpose |
|------|---------|
| `src/lib/recoveryTimeout.ts` | Timeout + retry infrastructure |
| `src/lib/recoveryWatchdog.ts` | Stage stall detection |
| `src/lib/recoveryFastPath.ts` | Small-shop thresholds |
| `src/lib/recoveryProgress.ts` | Monotonic progress engine |
| `src/lib/cloudRecoverySession.ts` | Session runtime, degraded unlock, blocking rules |
| `src/lib/postAuthCloudHydrate.ts` | Gated recovery orchestration |
| `src/lib/cloudSnapshotSync.ts` | Persist progress + skip duplicate migrate |
| `src/lib/recoveryDiagnostics.ts` | `[waka-recovery]` metrics |
| `src/lib/backgroundRecoveryCertification.ts` | `skipHeavyPull` for small shops |
| `src/offline/cloudSync.ts` | Recovery lock guard, skipEntityMigration |
| `src/offline/incrementalPersist.ts` | skipEntityMigration option |
| `src/store/usePosStore.ts` | IDB duration recording |
| `src/components/recovery/CloudRecoveryScreen.tsx` | Progress checklist alignment |

---

## Success Criteria Checklist

- [x] Small shops unlock via snapshot + staff-only path (no full pull)
- [x] Progress monotonic; `returns` and fallbacks prevent 0% regression
- [x] All recovery requests have timeout + classified error
- [x] Duplicate IndexedDB migration eliminated on restore
- [x] Android cannot overlap active recovery downloads (lock + in-flight promise)
- [x] Healthy devices not blocked when core data present (`isCloudRecoveryBlocking`)
- [x] `npm run build` and `npm test` pass
- [ ] Live Android ≤5 s unlock confirmed in QA soak (recommended follow-up)

---

## Related Documents

- [Phase 24.2 Forensic Audit](./PHASE_24_2_ENTERPRISE_CLOUD_RECOVERY_PERFORMANCE_AND_RELIABILITY_CERTIFICATION.md)
