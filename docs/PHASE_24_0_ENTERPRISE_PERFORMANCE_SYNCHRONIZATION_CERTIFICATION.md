# Phase 24.0 — Enterprise Performance & Synchronization Certification

**Mode:** Read-only forensic performance audit (no code changes)  
**Date:** 2026-07-12  
**Baseline:** Phase 23.0 — Production **8.7 / 10**, Performance **8.5 / 10**  
**Scope:** Startup, rendering, store, sync, IndexedDB, network, scale, Android, web bundle, memory, animation

---

## Executive Summary

WAKA POS is **functionally enterprise-grade** (Phases 14–22.6) but **does not yet consistently feel instant** compared to Shopify POS, Square POS, Lightspeed, or Toast POS. The gap is not a single bug — it is the **accumulated cost of layered startup gates, a monolithic in-memory store, timer-gated synchronization, and coarse React subscriptions** on high-traffic surfaces.

**Two distinct problem domains were audited separately:**

| Domain | Primary symptom | Root character |
|--------|-----------------|----------------|
| **Performance** | UI freezes, incomplete dashboard tiles, slow first paint | Blocking boot path, coarse rerenders, large eager bundle |
| **Synchronization** | Cloud changes feel delayed, queue lag | Timer-first scheduling, POS pull suppression, mutex serialization |

They interact (e.g. cloud merge triggers store `setState` → dashboard rerender) but **require different fix strategies**.

**Verdict: 🟡 Conditionally Certified for Performance at Scale**

WAKA POS meets **documented certification thresholds** for 20k products and 100k sales in isolated benchmarks, but **real-world perceived responsiveness** on Android — especially startup, dashboard KPI stability, and sync latency — falls short of tier-1 POS competitors.

**Overall Enterprise Performance Readiness: 7.4 / 10**

Target after Phase 24.1 implementation: **8.8–9.2 / 10** (instant *feel* without changing business behavior).

---

## Certification Methodology

1. **Static code-path tracing** — boot, hydrate, sync, dashboard, POS hot paths
2. **Timer/debounce inventory** — all values extracted from `syncTiming.ts`, `uiYield.ts`, orchestrators
3. **Existing perf test corpus** — 6 suites, thresholds documented (no new benchmarks added)
4. **Production build analysis** — `npm run build` executed 2026-07-12; chunk sizes measured from `dist/assets/`
5. **Cross-reference** — Phase 17.3, 23.0, `ANDROID.md`, boot trace / startup diagnostics instrumentation
6. **Competitive benchmark** — qualitative comparison vs Shopify POS, Square, Lightspeed, Toast

**Not performed:** Live Android Systrace, Chrome Performance profiles on production devices, Supabase latency A/B, heap snapshots under 50k+ catalog load.

---

## Part 1 — Startup Performance

### Startup sequence (measured architecture)

```
App launch (main.tsx)
  ├─ [sync] theme, crash handlers, stuck-startup recovery
  ├─ [sync] 4× font CSS imports
  ├─ warmupLocalDb() — fire-and-forget IDB open
  └─ React mount → AppProviders → Router

StartupBootstrapGate
  ├─ BLOCKS until auth resolved OR 6s auth timeout
  └─ 15s stall → escape UI

Authentication (useAuth)
  ├─ getSession() up to 6s (cached LS fallback)
  └─ applyAccountSwitchSync → flushPendingPersist + resetForSignOut

ProtectedRoute → BLOCKS while auth.initializing

DeviceActivationGateOutlet → BLOCKS while device check loading

PosDataProvider ★ PRIMARY DATA GATE
  ├─ bootPhase "disk"
  │    └─ bootstrapPosFromDisk() — up to 12s race timeout
  │         ├─ readEntityManifest()
  │         ├─ getEntitiesByBucket × 16+ parallel reads
  │         ├─ getEntitiesByIds("sale", 100 head IDs) — point reads
  │         └─ hydrateEssentials → _hydrated = true (internal)
  ├─ bootPhase "recovery" (if shouldRunCloudRecoveryForAccount)
  │    └─ runCloudRecoveryGated() — network + snapshot + pull + validate
  └─ bootPhase "ready" → AppShell + lazy routes
       └─ 12s escape timeout forces ready

Background (non-blocking after ready)
  ├─ schedulePostBootstrapTasks (requestIdleCallback ~1500ms)
  ├─ scheduleBackgroundCloudSync (800–2500ms delay)
  ├─ schedulePostLoginBackgroundTasks (device authority, hydrate, updates)
  └─ sales tail hydrate (200-record pages, yieldUiTick)
```

### Blocking work identified

| Stage | Max wait | File | Impact |
|-------|----------|------|--------|
| Auth session | 6s | `offlineSessionResilience.ts`, `StartupBootstrapGate.tsx` | Spinner before any route |
| Device activation | network-bound | `DeviceActivationGateOutlet.tsx` | Spinner before POS tree |
| **Disk bootstrap** | **12s** | `usePosStore.ts` → `bootstrapPosFromDisk` | **Blocks AppShell entirely** |
| Recovery probe | 8s | `firstTimeOwnerDevice.ts` | Delays recovery decision |
| **Cloud recovery** | **tens of seconds** | `postAuthCloudHydrate.ts` | Full-screen recovery on empty/second device |
| Boot escape | 12s | `PosDataProvider.tsx` | Forces ready with partial data |

### Key finding

`hydrateEssentials` marks `_hydrated = true` before all buckets finish loading, but **`PosDataProvider` still blocks the route tree** until `bootPhase === "ready"`. Users see `StartupLoadingScreen` for the **full** `bootstrapPosFromDisk` + recovery check — not just essentials.

**Startup score: 7.0 / 10**

---

## Part 2 — Dashboard Performance

### Surfaces audited

| Surface | Route | Primary files |
|---------|-------|---------------|
| Home launcher | `/` | `HomePage.tsx`, `DesktopHomeTiles.tsx`, `LivingDashboardCard.tsx` |
| Owner command center | `/owner` | `OwnerDashboardPage.tsx`, `EnterpriseDashboardShell.tsx` |

### Why users briefly see "incomplete" tiles

| Cause | Type | Evidence |
|-------|------|----------|
| **Permission/tier gating** | Intentional | `useHomeDashboardMetrics` returns `undefined` liveStat when role/subscription denies metric — tile renders without KPI strip |
| **Subscription fetch lag** | Transient | Home is **not** gated on `subscriptionLoading`; tier-gated stats pop in after fetch |
| **Progressive sales loading** | Transient | Initial 100 sales loaded; tail in 200-record batches → today's revenue/count **climbs over seconds** |
| **useDeferredValue** | Transient | Owner command center defers sales/audit recompute — one-frame stale KPIs |
| **Lazy route Suspense** | Transient | `LazyWait` before page mounts |
| **Device health async** | Transient | `useOwnerDeviceHealth` — devices-online KPI starts at 0 |
| **Widget null guards** | Transient | Registry widgets return `null` if ctx slice missing during first compute cycle |

**This is not primarily a skeleton/loading UX issue** — it is **data completeness + permission gating + progressive hydration** without stable placeholder semantics.

### Dashboard timing (certified benchmarks)

| Scenario | Dataset | Threshold | Test file |
|----------|---------|-----------|-----------|
| Owner dashboard summary | 1.2k sales | 700 ms | `performanceCertification.test.ts` |
| Owner dashboard | 10k sales | 1,000 ms | `backOfficePerformanceOptimization.test.ts` |
| Owner command center | 10k sales | 900 ms (Android sprint) / 2,500 ms (back-office) | `androidPerformanceSprint.test.ts` |
| Command center bundle | fingerprint-cached | Recomputes on sales batch load | `ownerDashboardCommandCenter.ts` |

**Dashboard score: 7.0 / 10**

---

## Part 3 — Rendering Performance

### Rerender hotspots

| Source | Mechanism | Blast radius |
|--------|-----------|--------------|
| **`OwnerDashboardPage`** | 21 coarse `usePosStore` selectors, entire `preferences` object | Full command center recompute |
| **`SyncStatusProvider`** | Context value **not memoized**; 30s queue poll on native | `DesktopStatusChips` on home |
| **`BusinessBuilderProvider`** | `useHomeBusinessSceneSync` patches scene on product count / prefs change | Hero SVG tree (~350 lines) |
| **Sales batch hydrate** | Each 200-sale page → `setState(sales)` | All `usePosStore(s => s.sales)` subscribers |
| **`DisplayScaleProvider`** | Re-evaluates on every route change | App-wide |
| **`useKampalaCalendarTick`** | 30s timer | Home metrics month labels |

### Memoization & virtualization

| Area | Virtualized? | Notes |
|------|--------------|-------|
| POS products | ✅ | `VirtualizedProductGrid.tsx` |
| Stock / inventory | ✅ | `InventoryProductList.tsx` |
| Receipts | ✅ | threshold 12 |
| Customer debts | ✅ | threshold 12 |
| Command center | ❌ | 14 slots, shared monolithic `ctx`, no `React.memo` on widgets |
| Home tiles | ❌ | Small fixed count; heavy Lottie/parallax per tile |
| Legacy stock list | ⚠️ | `VirtualizedStockProductList.tsx` **defined but unused** |

### Render waterfalls

Typical home cascade:

```
sales batch load → useReportingSales → useHomeDashboardMetrics
  → all LivingDashboardCard children rerender

SyncStatusProvider poll (30s) → DesktopStatusChips rerender

products change → lowStockCount → badges + liveStats recompute
```

**Rendering score: 6.8 / 10**

---

## Part 4 — Store Performance

### Architecture

- **Zustand monolith:** `usePosStore.ts` (~8,200 LOC), 250+ importers
- **Full shop snapshot in RAM:** products, sales, archivedSales, customers, auditLogs, purchases, stockMovements, etc.
- **Persistence:** debounced incremental persist — **3,500 ms native / 500 ms web** (`uiYield.ts`)

### Hydration strategy

| Phase | Behavior |
|-------|----------|
| Essentials | products, customers, prefs → `_hydrated = true` |
| Sales head | 100 sales synchronously on boot path |
| Sales tail | Background pages of 200 with `yieldUiTick` |
| Legacy fallback | Full KV snapshot + idle remainder hydrate |

### Selector patterns

| Good | Bad (dashboard paths) |
|------|----------------------|
| `useShallow` on PosPage, AppShell prefs slice | `OwnerDashboardPage`: whole arrays + full `preferences` |
| `buildProductSellSearchIndex` memoized on PosPage | `DesktopHomeTiles`: full `products`, `preferences` refs |
| `getCachedComputation` (32 entries) for reports/CC | Any `usePosStore(s => s.sales)` — rerenders on every batch |

### Store as bottleneck?

**Yes, on dashboard and reporting surfaces.** The store is not slow at mutation — it is **too coarse for subscribers**. Any sales page load invalidates every whole-array subscriber.

**Store score: 7.0 / 10**

---

## Part 5 — Synchronization

### Sync architecture classification

| Model | Assessment |
|-------|------------|
| Offline-first | ✅ Primary design |
| Event-driven upload | 🟡 Partial — sale triggers debounced push, but delivery is timer-gated |
| Near-real-time download | ❌ Not on POS routes — pull **paused** during selling |
| Background-first | ✅ Merge uses `yieldUiTick`; push continues on POS |
| Timer-driven steady state | ✅ Dominant on native |

### Native sync timing (from `syncTiming.ts`)

| Constant | Native | Desktop | Effect on perceived sync |
|----------|--------|---------|--------------------------|
| `POST_SALE_PUSH_DEBOUNCE_MS` | **500 ms** | 120 ms | First upload attempt delayed after checkout |
| `MIN_POS_PUSH_GAP_MS` | **4,000 ms** | 600 ms | Skips push if recent attempt |
| `POS_PUSH_INTERVAL_MS` | **12,000 ms** | 4,000 ms | Background retry cadence on POS |
| `SYNC_PULL_MIN_INTERVAL_MS` | **120,000 ms (2 min)** | 45,000 ms | Auto-pull throttle |
| `SYNC_MIN_FULL_INTERVAL_MS` | **90,000 ms** | 18,000 ms | Full sync cycle minimum gap |
| `SYNC_QUEUE_POLL_MS` | **30,000 ms** | 6,000 ms | UI badge lag vs queue reality |
| `startupIdleMs` | 600 ms | 120 ms | Delay before first background sync |

### Sync flow (text)

```
Local mutation → queueRemote() / pendingSync flag
  → schedulePushPendingUploads (debounced)
  → pushShopPendingToCloud [globalSyncMutex]
       ├─ pending sales (parallel, concurrency 3 native)
       ├─ drawer/shifts/closes (sequential loops)
       └─ flushSyncQueueInner (parallel with backoff)

Full sync → syncShopWithCloud [mutex]
  ├─ pull? (gated: route, shouldPullFromCloud, min interval)
  ├─ pullCloudAndMergeIntoStore (chunked merge + yieldUiTick)
  ├─ staff pull (45s min interval)
  └─ push + idle snapshot upload (15s native defer)
```

### Why sync feels delayed (concrete)

1. **500 ms post-sale debounce** before first push (native)
2. **4 s minimum gap** between POS pushes
3. **12 s interval** for background push retries on POS
4. **Pull suppressed on `/pos`, `/stock`, `/reports`, `/customers`, `/owner`** — other devices' changes invisible until leaving route or manual sync
5. **2 min minimum** between automatic pulls (native)
6. **Global sync mutex** — hydrate/recovery blocks push (`sync_busy`)
7. **Sequential entity pulls** in incremental download
8. **Queue backoff** — 2 s → 5 min exponential cap after failures
9. **UI queue badge** polls every 30 s on native — stale pending count
10. **`syncSaleImmediately` defined but never called** — immediate path exists but is unused

### Average sync latency (estimated from architecture)

| Operation | Best case (native) | Typical | Worst case |
|-----------|-------------------|---------|------------|
| Sale upload after checkout | ~500 ms debounce + RPC | 4–12 s (gap/interval) | Queue backoff minutes |
| Cross-device product change visible on POS | Manual sync or leave POS | 2+ min (pull interval) | Until app backgrounded |
| Full shop hydrate (recovery) | Network-bound | 10–30+ s | Timeout / escape |
| Queue drain after failure | 2 s backoff | 25 s auto-drain | 5 min cap |

**Sync score: 6.5 / 10** (conservative by design on Android; feels slow vs Square/Shopify)

---

## Part 6 — IndexedDB

### Schema

- DB: `waka-pos-offline` v5
- Stores: `kv`, `records`, `syncQueue`, `backups`, `staffCache`
- Early warmup: `warmupLocalDb()` in `main.tsx` (non-blocking)

### Cold-start read pattern (entity path)

1. `readEntityManifest()` — single KV read
2. `getEntitiesByBucket("product")` + `("customer")` — indexed (or **full table scan** on legacy)
3. `getEntitiesByIds("sale", headIds)` — **one get per sale ID** (up to 100)
4. `Promise.all` of **16+ bucket reads**
5. Archived sales — point reads per ID

### Cold-start writes

- Read-only during bootstrap (persist suspended)
- Cloud recovery: `migrateSnapshotToEntities` + `flushFullSnapshotPersist` — **heavy synchronous write burst**

### Risk flags

| Flag | Severity | Evidence |
|------|----------|----------|
| Legacy full-table scan | P1 | `readEntitiesByBucketLegacyScan` → `performanceMetrics.bootstrapUsedFullTableScan` |
| 100 sequential sale gets | P1 | Boot critical path |
| Post-recovery full persist | P0 | Blocks recovery completion |
| Native persist debounce 3.5 s | P2 | Large mutation bursts feel laggy to persist |

**IndexedDB score: 7.5 / 10**

---

## Part 7 — Network Pipeline

### RPC patterns

- Sale push: `shop_push_sale_complete`, `shop_push_pending_sale` (parallel pool)
- Incremental pull: per-entity cursors (`syncCheckpoints.ts`), paginated (500 sales/products/customers per page)
- Full pull: 800 sales/page, max 40 pages

### Waterfalls identified

| Waterfall | Location |
|-----------|----------|
| Recovery: probe → snapshot → pull → validate → upload | `postAuthCloudHydrate.ts` |
| Incremental pull: products → customers → sales → expenses (sequential awaits) | `cloudSync.ts` |
| Push: sales parallel → drawer/shifts sequential → queue flush | `pushShopPendingToCloudInner` |
| Staff pull throttled 45 s during full sync | `staffRecovery.ts` |

### Batch opportunities (not implemented)

- Sale head IDs: single cursor read vs N point gets
- Parallel incremental entity pulls where independent
- Coalesce heartbeat + presence with push cycle

**Network efficiency score: 7.5 / 10**

---

## Part 8 — Large Dataset Certification

### Certified thresholds (automated tests)

| Dataset | Operation | Threshold | Status |
|---------|-----------|-----------|--------|
| **20k products** | Indexed POS search | 300 ms | ✅ (Windows CI variance noted) |
| **20k products** | Category filter | 320 ms | ✅ |
| **100k sales** | Receipts partition | 400 ms | ✅ |
| **100k sales** | Reports range summary | 4,000 ms | ✅ |
| **20k audit** | Investigation filter | 600 ms | ✅ |
| **10k sales** | Owner command center | 900 ms (Android) / 2,500 ms | ✅ |
| **10k sales** | Reports panel | 3,500 ms | ✅ |
| **1k products** | Inventory filter/sort | 300 ms | ✅ |

### Not certified

| Scale | Gap |
|-------|-----|
| **50k products** | No benchmark |
| **50k+ customers** | No benchmark |
| **100k products** | No benchmark |
| **Startup at 50k catalog** | No benchmark |
| **Memory at 100k sales + 20k products** | Measure-only profile tests, no gates |

### Scale assessment

WAKA POS is **certified for mid-market single-shop scale** (≤20k SKUs, ≤100k sales history for reporting). **Enterprise catalog sizes** (50k–100k SKUs) are **unverified**.

**Large dataset score: 7.5 / 10**

---

## Part 9 — Android Performance

### Platform configuration

| Setting | Value |
|---------|-------|
| Capacitor | v8, `ug.waka.pos` |
| minSdk / targetSdk | 24 / 36 |
| WebView debugging | Disabled in production |
| Splash | 2.5 s manual hide, immersive |
| Keyboard | `resize: "body"` |

### Android-specific timing penalties

| Concern | Native vs Web |
|---------|---------------|
| IDB persist debounce | **3,500 ms** vs 500 ms |
| `yieldUiTick` | **16 ms** setTimeout vs idle callback |
| Cloud snapshot upload defer | **15,000 ms** vs 4,000 ms |
| Sync visibility delay | **1,200 ms** vs 80 ms |
| App resume sync delay | **1,500 ms** vs 80 ms |

### Android bottlenecks

1. **WebView single-thread jank** — merge/persist yields help but don't eliminate
2. **Conservative sync cadence** — 500 ms / 4 s / 12 s / 2 min stack
3. **1.3 MB main chunk** — parse/compile on mid-range devices
4. **Capacitor bridge** — biometrics, updates, network events add main-thread work
5. **`soak:android` harness exists** — manual device checklist, not CI-gated

**Android score: 6.8 / 10**

---

## Part 10 — Web Performance

### Build output (2026-07-12)

| Chunk | Size |
|-------|------|
| `internal-admin-*.js` | **4,582 KB** (route-only, excluded from precache) |
| `index-*.js` (main) | **1,310 KB** |
| `lottie-*.js` | 309 KB |
| `react-vendor-*.js` | 174 KB |
| `capacitor-*.js` | 36 KB |
| PWA precache | **207 entries, ~5.5 MB** |

### Code splitting

| Coverage | Count |
|----------|-------|
| Lazy routes (`React.lazy`) | ~50 pages |
| Eager routes (settings, cash, inventory hub) | ~45 pages still in main graph |
| Manual vendor chunks | jspdf, html2canvas, lottie, maps, xlsx, charts, supabase, capacitor, react, router, internal-admin |

### Gaps

- **`/stock` (InventoryPurchasingPage) is eager-loaded** despite being high-traffic and pull-deferred for sync
- Settings cluster (~20 pages) eager — inflates main graph for all users
- No route-based prefetch for `/pos` after home load

**Web score: 8.0 / 10**

---

## Part 11 — Background Work

### Deferred correctly ✅

| Work | Deferral mechanism |
|------|-------------------|
| Cloud pull on POS | `backgroundWorkPolicy.ts` — paused |
| Post-bootstrap tasks | `requestIdleCallback` ~1500 ms |
| Sales tail hydrate | async + yieldUiTick |
| Snapshot upload | `runWhenIdle` 15 s native |
| Update engine evaluate | post-login dynamic import |
| Office hub heavy cards | lazy + idle |

### Competes with UI ⚠️

| Work | Risk |
|------|------|
| `hydrateAccountFromCloud` | Mutex — can block push during login |
| Incremental persist (3.5 s debounce burst) | Main thread + IDB write |
| `BusinessBuilderScene` SVG updates | Home hero rerenders |
| `SyncStatusProvider` 30 s poll | Home footer rerender |
| Play update download | Bottom overlay during flexible update |

**Background tasks score: 7.8 / 10**

---

## Part 12 — Memory

### Patterns

| Pattern | Assessment |
|---------|------------|
| Full shop in Zustand | All products/sales/customers in RAM |
| Progressive sales load | Reduces initial load but grows heap over session |
| `getCachedComputation` (max 32) | Good — reports/CC |
| `useDeferredValue` on reporting | Good — avoids blocking typing |
| Virtualized lists | Good — POS, stock, receipts, debts |
| Audit filter cap 200 | Good |
| Archived sales merge on reports | Memory grows with history depth |

### Leak risks (low confidence without profiling)

- Context listeners without memoization (`SyncStatusProvider`)
- Boot trace ring buffer in localStorage (bounded)
- `EnterpriseUpdateEngine` listener Set (bounded)

**Memory score: 7.0 / 10**

---

## Part 13 — Animation Performance

Phase 22.6 motion system:

- All animations ≤ 320 ms with `prefers-reduced-motion` fallbacks
- Shimmer skeletons use CSS gradient (`waka-skeleton-bar`) — GPU-friendly
- Modal enter: 180–280 ms — unlikely to block main thread alone
- Card `active:scale` — compositor-friendly

**Risk:** Heavy home tiles (Lottie, parallax, gradients) + motion on same surfaces during sales-driven rerenders may compound jank on low-end Android — **not measured in CI**.

**Animation score: 8.5 / 10** (presentation layer is light; data rerenders are the bigger issue)

---

## Part 14 — Synchronization Architecture Certification

| Question | Answer |
|----------|--------|
| Is sync immediate? | **No** — debounced + gap + interval on native |
| Near-real-time? | **Partial** — desktop push cadence acceptable; native POS pull suppressed |
| Background-first? | **Yes** — merge yields, push on POS continues |
| Offline-first? | **Yes** — IndexedDB queue + pendingSync |
| Can sync become event-driven? | **Yes, partially** — infrastructure exists (`syncSaleImmediately` unused; sale event already fires scheduler) |

### Recommended architecture direction (24.1 — not implemented)

1. **Event-driven push** on sale/stock mutation with desktop-like cadence on native (reduce debounce/gap when online + idle)
2. **Incremental pull on visibility** with shorter interval off POS, websocket/nudge for multi-device (future)
3. **Split mutex** — push-only must not wait for full pull/hydrate
4. **Optimistic UI** for sync badge — derive from store pending flags, not 30 s poll

---

## Part 15 — Enterprise Comparison

Qualitative vs tier-1 POS (2026 expectations):

| Dimension | Shopify POS | Square | Lightspeed | Toast | WAKA POS |
|-----------|-------------|--------|------------|-------|----------|
| Cold start to sell | ~1–2 s | ~1–2 s | ~2–3 s | ~2–3 s | **3–8+ s** (gates + disk + optional recovery) |
| Dashboard KPI stability | Stable on load | Stable | Stable | Stable | **Climbs** as sales pages load |
| Sale → cloud visible | ~1–3 s | ~1–2 s | ~2–5 s | ~2–5 s | **4–15+ s native** (debounce + gap + interval) |
| Offline sell | ✅ | ✅ | ✅ | ✅ | ✅ |
| Multi-device sync while selling | Background pull | Background | Background | Background | **Pull paused on POS** |
| 20k SKU search | Fast | Fast | Fast | N/A | ✅ Certified ~300 ms |
| Full local data model | Cloud-first hybrid | Cloud-first | Varies | Cloud | **Full offline mirror** (tradeoff) |

**WAKA's offline-first mirror is a strength for Uganda connectivity; it is the primary reason startup and sync feel slower than cloud-first competitors.**

---

## Part 16 — Performance Score

| Category | Score (/10) | Rationale |
|----------|-------------|-----------|
| **Startup** | 7.0 | Layered gates; PosDataProvider blocks shell for full disk + recovery |
| **Rendering** | 6.8 | Coarse store selectors; unmemoized SyncStatus; command center monolith |
| **Sync** | 6.5 | Timer-gated native cadence; pull paused on POS |
| **IndexedDB** | 7.5 | Solid entity model; boot path still heavy |
| **Android** | 6.8 | WebView + conservative timers + 1.3 MB main chunk |
| **Web** | 8.0 | Good splitting; large eager settings graph |
| **Memory** | 7.0 | Full snapshot in RAM; progressive sales growth |
| **Large datasets** | 7.5 | 20k/100k certified; 50k+ untested |
| **Navigation** | 7.5 | 50 lazy routes; Suspense flash; eager inventory |
| **Background tasks** | 7.8 | Well-deferred pull on POS; some mutex contention |

### Overall Enterprise Performance Readiness: **7.4 / 10**

For comparison:

| Phase | Score |
|-------|-------|
| Phase 23.0 Performance | 8.5 / 10 (infrastructure/certification focus) |
| Phase 24.0 Perceived responsiveness | **7.4 / 10** (user-feel focus) |

The delta reflects that **passing isolated benchmarks ≠ feeling instant in daily use**.

---

## Part 17 — Root Cause Register

### P0 — Highest user-visible impact

| ID | Root cause | Business impact | Est. impact | Affected modules | Strategy |
|----|------------|-----------------|-------------|------------------|----------|
| RC-P0-01 | **PosDataProvider blocks AppShell until full disk bootstrap + recovery check** | Users stare at startup screen 3–12+ s | High | `PosDataProvider.tsx`, `usePosStore.ts` | **Essentials-first shell**: render AppShell after products/customers/prefs; defer buckets + recovery UI |
| RC-P0-02 | **Native sync debounce 500 ms + 4 s gap + 12 s interval** | Sale not visible on other device for 4–15 s | High | `syncTiming.ts`, `posPushScheduler.ts` | Tiered push: immediate first attempt online, respect gap only for retries |
| RC-P0-03 | **Pull paused on POS/owner/stock routes** | Owner on register never sees remote changes | High | `backgroundWorkPolicy.ts`, `useSyncStatus.tsx` | Lightweight incremental pull off main thread or on idle; never block sell path |
| RC-P0-04 | **Progressive sales load mutates KPIs** | Dashboard/home numbers climb — looks broken | High | `activeSalesWindow.ts`, `useReportingSales.ts`, dashboards | Precompute today KPIs from indexed summary; decouple from full sales array |
| RC-P0-05 | **Cloud recovery on empty/second device blocks UI** | New device setup feels frozen | High | `postAuthCloudHydrate.ts`, `PosDataProvider.tsx` | Stream recovery progress; render shell with partial data; parallelize pull |

### P1 — Significant

| ID | Root cause | Business impact | Est. impact | Affected modules | Strategy |
|----|------------|-----------------|-------------|------------------|----------|
| RC-P1-01 | **OwnerDashboardPage 21 coarse store selectors** | Command center jank on any pref/sales change | Medium | `OwnerDashboardPage.tsx` | `useShallow`, derived selectors, split ctx by slot |
| RC-P1-02 | **SyncStatusProvider unmemoized context + 30 s poll** | Home/footer rerenders; stale badge | Medium | `useSyncStatus.tsx` | Memoize value; derive pending from store |
| RC-P1-03 | **100 sequential sale ID gets on boot** | Adds 100–500 ms+ to disk phase | Medium | `entityStore.ts`, `usePosStore.ts` | Cursor/batch read in single transaction |
| RC-P1-04 | **Global sync mutex serializes push during hydrate/recovery** | Push skipped with `sync_busy` during login | Medium | `globalSyncMutex.ts` | Separate push mutex from pull/hydrate |
| RC-P1-05 | **Legacy IDB full-table scan fallback** | Catastrophic boot on large legacy shops | Medium | `entityStore.ts` | Migration guard; refuse scan in prod |
| RC-P1-06 | **Main bundle 1.3 MB + eager settings/stock** | Slow first parse on Android | Medium | `App.tsx`, `vite.config.ts` | Lazy `/stock`, settings cluster split |
| RC-P1-07 | **`syncSaleImmediately` exists but unused** | Missed fast-path for critical uploads | Medium | `cloudSync.ts` | Wire to checkout completion for online shops |

### P2 — Moderate

| ID | Root cause | Business impact | Est. impact | Affected modules | Strategy |
|----|------------|-----------------|-------------|------------------|----------|
| RC-P2-01 | Home not gated on subscription fetch | Tier-gated tiles pop in | Low | `SubscriptionContext.tsx`, home | Hold liveStat until snapshot ready or show skeleton |
| RC-P2-02 | BusinessBuilder SVG rerenders on product count | Home hero jank | Low | `BusinessBuilderContext.tsx` | Memo scene; throttle patches |
| RC-P2-03 | Native IDB persist debounce 3.5 s | Large session burst delay | Low | `uiYield.ts` | Adaptive debounce by mutation size |
| RC-P2-04 | Command center no widget memoization | 14-slot full rerender | Low | `EnterpriseDashboardShell.tsx` | `React.memo` per slot |
| RC-P2-05 | 50k+ catalog untested | Enterprise rollout risk | Medium | perf tests | Add 50k certification suite |
| RC-P2-06 | Post-recovery `flushFullSnapshotPersist` | Recovery tail latency | Medium | `incrementalPersist.ts` | Incremental persist only |

### P3 — Incremental

| ID | Root cause | Business impact | Est. impact | Affected modules | Strategy |
|----|------------|-----------------|-------------|------------------|----------|
| RC-P3-01 | 4× sync font imports in main.tsx | Minor first paint delay | Low | `main.tsx` | Font subsetting / preload |
| RC-P3-02 | Unused `VirtualizedStockProductList` | Dead code | None | stock components | Wire or remove |
| RC-P3-03 | Heartbeat paused on POS | Stale device presence | Low | `useShopPresenceHeartbeat.ts` | Decouple from pull policy |
| RC-P3-04 | Lazy route Suspense flash | Brief blank on navigation | Low | `App.tsx` | Prefetch adjacent routes |

---

## Part 18 — Phase 24.1 Blueprint (Implementation Roadmap)

**Mode:** Performance-only implementation (no business logic changes)  
**Target:** Enterprise Performance Readiness **8.8–9.2 / 10**  
**Estimated effort:** 4–6 weeks focused engineering

### Sprint 1 — Instant shell (P0, ~1 week)

| Task | Addresses | Expected gain |
|------|-----------|---------------|
| Essentials-first boot gate | RC-P0-01 | AppShell visible **1–3 s** sooner on returning users |
| Today KPI summary index (sales head metadata) | RC-P0-04 | Stable dashboard numbers on first paint |
| Batch sale head read (single IDB transaction) | RC-P1-03 | **200–800 ms** off disk phase |

### Sprint 2 — Sync feels immediate (P0, ~1 week)

| Task | Addresses | Expected gain |
|------|-----------|---------------|
| Native push cadence retune (120 ms debounce, 1 s gap, 4 s interval) | RC-P0-02 | Sale visible on device 2 **~1–3 s** |
| Wire `syncSaleImmediately` for online checkout | RC-P1-07 | Critical path upload |
| Push/pull mutex split | RC-P1-04 | No `sync_busy` during hydrate |
| Incremental micro-pull on idle (off POS thread) | RC-P0-03 | Remote changes within **30–60 s** without leaving POS |

### Sprint 3 — Dashboard & rendering (P1, ~1 week)

| Task | Addresses | Expected gain |
|------|-----------|---------------|
| OwnerDashboard selector refactor (`useShallow`, split ctx) | RC-P1-01 | **50–70%** fewer CC rerenders |
| Memoize `SyncStatusProvider` value; store-derived pending | RC-P1-02 | Eliminate 30 s poll rerenders |
| `React.memo` command center widgets | RC-P2-04 | Slot isolation |
| Home subscription gate / KPI skeleton semantics | RC-P2-01 | No "incomplete" tile confusion |

### Sprint 4 — Bundle & Android (P1, ~1 week)

| Task | Addresses | Expected gain |
|------|-----------|---------------|
| Lazy `/stock` + settings cluster | RC-P1-06 | **200–400 KB** off main path |
| Route prefetch `/` → `/pos` | RC-P3-04 | Faster sell entry |
| Android profiling pass (Systrace + Lighthouse TBT) | RC-P0-05 validation | Evidence-based tuning |

### Sprint 5 — Scale & recovery (P2, ~1 week)

| Task | Addresses | Expected gain |
|------|-----------|---------------|
| 50k product certification suite | RC-P2-05 | Enterprise catalog confidence |
| Stream cloud recovery UI + parallel pull | RC-P0-05 | Second device setup **2× faster feel** |
| Incremental persist after recovery | RC-P2-06 | Shorter recovery tail |

### Sprint 6 — Certification & guardrails (~3 days)

| Task | Purpose |
|------|---------|
| Add `npm run perf:certify` — aggregate perf suites | CI gate |
| Startup timing marks in `performanceMetrics` | Field telemetry |
| Phase 24.1 completion doc | Score re-certification |

### Explicit non-goals for 24.1

- No business logic / RPC contract changes
- No CRDT / conflict model rewrite
- No store monolith split (deferred to 25.x maintainability)
- No Supabase schema migrations

---

## Success Criteria — Met (Audit Phase)

At the end of Phase 24.0 we know:

| Question | Answer |
|----------|--------|
| Why startup sometimes freezes? | Layered gates + full disk bootstrap + optional cloud recovery before AppShell |
| Why dashboard briefly renders incomplete tiles? | Permission gating + subscription lag + progressive sales KPI recompute |
| Why synchronization feels delayed? | Native timer stack (500 ms / 4 s / 12 s / 2 min) + pull paused on POS |
| Which operations block UI? | `bootstrapPosFromDisk`, `runCloudRecoveryGated`, auth init, device activation |
| Largest real-world improvements? | Essentials-first shell, sync cadence retune, KPI decoupling, selector refactor |
| Roadmap to feel instant? | Phase 24.1 blueprint above |

---

## Verification (Audit Commands)

| Command | Result (2026-07-12) |
|---------|---------------------|
| `npm run build` | ✅ Pass (~207 s); PWA precache 207 entries ~5.5 MB |
| Code-path audit | ✅ Complete (this document) |
| Implementation | ❌ None (read-only phase) |

---

## Appendix — Key Reference Files

| Area | Path |
|------|------|
| Boot entry | `src/main.tsx` |
| Data gate | `src/providers/PosDataProvider.tsx` |
| Store bootstrap | `src/store/usePosStore.ts` |
| IndexedDB | `src/offline/localDb.ts`, `src/offline/entityStore.ts` |
| Sync timing | `src/lib/syncTiming.ts` |
| Cloud sync | `src/offline/cloudSync.ts` |
| Sync orchestration | `src/hooks/useSyncStatus.tsx` |
| Pull pause policy | `src/lib/backgroundWorkPolicy.ts` |
| Home dashboard | `src/hooks/useHomeDashboardMetrics.ts` |
| Command center | `src/pages/OwnerDashboardPage.tsx` |
| Perf certification | `src/lib/enterprisePerformanceScalability.test.ts` |
| UI yield / native timing | `src/lib/uiYield.ts` |
| Vite splitting | `vite.config.ts` |

---

**Phase 24.0 complete. Proceed to Phase 24.1 implementation when approved.**
