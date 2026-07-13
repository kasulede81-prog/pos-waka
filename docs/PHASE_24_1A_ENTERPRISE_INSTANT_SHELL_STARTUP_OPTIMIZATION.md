# Phase 24.1A — Enterprise Instant Shell & Startup Optimization

**Mode:** Enterprise implementation (performance only)  
**Date:** 2026-07-12  
**Baseline:** Phase 24.0 Performance Readiness **7.4 / 10** (startup **7.0 / 10**)

---

## Executive Summary

Phase 24.1A transforms WAKA POS startup into an **essentials-first architecture**. The AppShell becomes interactive after critical IndexedDB hydration (products, customers, preferences, cached today KPIs) while sales tail, back-office buckets, cloud recovery, and sync-adjacent work run in a **prioritized background scheduler**.

**Target perceived startup score: 8.8+ / 10** (Phase 24.1B will address sync latency).

---

## Before vs After Startup Sequence

### Before (Phase 24.0)

```
Auth → Device gates → PosDataProvider BLOCKS
  → bootstrapPosFromDisk (full: 16+ buckets + 100 sales + remainder)
  → cloud recovery check (blocking full screen)
  → AppShell ready (3–12+ seconds)
```

### After (Phase 24.1A)

```
Auth → Device gates → PosDataProvider
  → bootstrapPosCriticalFromDisk (~products + customers + prefs + KPI cache)
  → AppShell READY (shell_render / first_interactive marks)
  → [background scheduler]
       P1: bootstrapPosInteractiveFromDisk (sales head)
       P2: bootstrapPosBackgroundFromDisk (remainder buckets + sales tail)
       P3: cloud recovery (overlay, non-blocking to shell mount)
```

---

## Hydration Stages

| Stage | Function | Data loaded | Blocks shell? |
|-------|----------|-------------|---------------|
| **Critical** | `bootstrapPosCriticalFromDisk` | Products, customers, preferences, today KPI KV cache | **Yes** (minimal) |
| **Interactive** | `bootstrapPosInteractiveFromDisk` | Sales head (100), KPI snapshot refresh | No |
| **Background** | `bootstrapPosBackgroundFromDisk` | All remainder buckets, archived sales, sales tail | No |
| **Complete** | `hydrationStage: "complete"` | Post-bootstrap tasks (draft, cloud profile, sync schedule) | No |

Store field: `hydrationStage: "none" | "critical" | "interactive" | "background" | "complete"`

---

## Stable Dashboard KPIs

**Problem:** Home/command center KPIs climbed as sales loaded in 200-record batches.

**Solution:** `TodayKpiSnapshot` persisted in IndexedDB KV (`{accountKey}::today-kpi-v1`).

| Component | Path |
|-----------|------|
| Snapshot read/write | `src/lib/todayKpiSnapshot.ts` |
| Store field | `todayKpiSnapshot` on `usePosStore` |
| Stable home metrics | `useHomeDashboardMetrics` uses `resolveStableTodayKpi` while `salesHistoryHydration.active` |
| Sale completion bump | Checkout path updates snapshot + async KV write |
| Background hydrate end | Refreshes snapshot when sales tail completes |

---

## Background Task Scheduler

| Priority | Task | Module |
|----------|------|--------|
| 0 | Auth + shell (sync) | `PosDataProvider`, `ProtectedRoute` |
| 1 | Interactive hydrate | `bootstrapPosInteractiveFromDisk` |
| 2 | Background hydrate | `bootstrapPosBackgroundFromDisk` |
| 3 | Cloud recovery | `runCloudRecoveryGated` (overlay, not gate) |
| 4+ | Updates, diagnostics | Existing deferred paths unchanged |

Scheduler: `src/lib/startupScheduler.ts`

---

## Startup Performance Metrics

Logged as `[waka-performance] {phase}={elapsedMs}ms` in dev or when `localStorage waka.performance.log=1`.

| Phase | Meaning |
|-------|---------|
| `auth_ready` | ProtectedRoute auth resolved |
| `critical_hydrate_start/end` | Critical IDB read |
| `shell_render` | AppShell allowed to mount |
| `first_interactive` | Navigation usable |
| `interactive_hydrate_end` | Sales head loaded |
| `dashboard_ready` | Shell + home route viable |
| `background_hydrate_end` | Remainder buckets loaded |
| `background_complete` | Post-bootstrap tasks scheduled |

Module: `src/lib/startupPerformance.ts`

---

## Render Optimizations

| Change | File |
|--------|------|
| Memoized `SyncStatusProvider` context value | `useSyncStatus.tsx` |
| Stable today KPIs decoupled from sales batch loads | `useHomeDashboardMetrics.ts` |
| Cloud recovery as fixed overlay over shell | `PosDataProvider.tsx` |

---

## Key Files Changed

| File | Change |
|------|--------|
| `src/providers/PosDataProvider.tsx` | Essentials-first boot, background scheduler, recovery overlay |
| `src/store/usePosStore.ts` | Staged bootstrap exports, `hydrationStage`, `todayKpiSnapshot` |
| `src/lib/todayKpiSnapshot.ts` | KPI cache + stable resolve |
| `src/lib/startupScheduler.ts` | Priority background queue |
| `src/lib/startupPerformance.ts` | `[waka-performance]` timeline |
| `src/hooks/useHomeDashboardMetrics.ts` | Stable KPI display |
| `src/hooks/useSyncStatus.tsx` | Memoized provider value |

---

## Regression Protection

| Area | Status |
|------|--------|
| Offline startup | ✅ Critical path still reads local IDB first |
| Authentication | ✅ Unchanged |
| Security / recovery logic | ✅ Same `runCloudRecoveryGated`; UI non-blocking only |
| Sync algorithms | ✅ Unchanged (24.1B scope) |
| Business logic | ✅ No RPC/schema changes |

---

## Verification

| Check | Result (2026-07-12) |
|-------|---------------------|
| `npm run build` | ✅ Pass |
| `npm test` | ✅ Pass (includes `todayKpiSnapshot.test.ts`) |

---

## Remaining Work — Phase 24.1B (Sync)

- Native push cadence retune (500 ms / 4 s / 12 s stack)
- Push/pull mutex split
- `syncSaleImmediately` wiring
- Incremental micro-pull on idle while on POS
- Cross-device near-real-time feel

---

## Success Criteria — Met

- ✅ AppShell visible after critical hydrate (not full disk + recovery)
- ✅ Navigation interactive before background work completes
- ✅ Dashboard KPIs stable during sales tail hydration
- ✅ Cloud recovery no longer blocks shell mount
- ✅ Startup metrics instrumented
- ✅ Build and tests pass

**Phase 24.1A complete. Proceed to Phase 24.1B when approved.**
