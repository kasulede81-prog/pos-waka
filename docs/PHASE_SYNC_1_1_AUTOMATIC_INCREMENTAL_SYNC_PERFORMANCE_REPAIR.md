# Phase SYNC-1.1 — Automatic Incremental Sync Performance Repair

**Date:** 2026-08-13  
**Prerequisite:** SYNC-1.0 CONDITIONAL GO (6.2/10)  
**Mode:** Scoped implementation — no POS/auth/RLS/checkout redesign  
**Production target:** WAKA POS Web + Android + iOS / Capacitor

Device round-trip times were **not measured**. Claims below are architectural (request count / concurrency), not stopwatch results.

---

## SYNC-1.1 IMPLEMENTATION RESULT

### Files changed

| File | Change |
|------|--------|
| `src/lib/syncReasons.ts` | Pull reasons, sale-ACK entity scope, checkpoint patch helper |
| `src/lib/foregroundSync.ts` | Shared AppState + visibility debounce → one `resume` sync |
| `src/lib/incrementalPullCoalesce.ts` | Single-flight + follow-up upgrade (sale_ack → resume) |
| `src/lib/shopSyncContext.ts` | One shop/user context per sync tick |
| `src/lib/asyncPool.ts` | `mapPoolResults` for bounded concurrent reads |
| `src/lib/syncTiming.ts` | Incremental pull concurrency + realtime coalesce |
| `src/offline/cloudSync.ts` | Reason-scoped pull, bounded parallel incremental entities, tick cache, ancillary skip on sale ACK |
| `src/lib/immediateSync.ts` | Sale ACK no longer `force: true` |
| `src/hooks/useSyncStatus.tsx` | Visibility + AppState share `scheduleForegroundSync` |
| `scripts/test-domains.json` | Include new sync tests |
| Tests | Focused regression coverage |

**Not changed:** cart, checkout, pricing, inventory math, barcode, payments, auth, RLS, sale semantics, staff PIN verification.

### Architectural changes

1. **Sale ACK is reason-scoped** — pulls **sales only**. Does not pull products, customers, expenses, returns, purchases, suppliers, payments, debts, drawer, counts, shifts, day closes, hospitality, staff, or device authority. Stock is already applied locally at checkout; it is not re-downloaded on ACK.
2. **Foreground events collapse** — native AppState + `visibilitychange` become one logical `resume` sync.
3. **Incremental entity reads use bounded concurrency** (native/mobile web 4, desktop 5). Full bootstrap stays sequential.
4. **Shop context is resolved once per tick** and reused by entity pulls, hospitality, and PIN hydrate.
5. **Overlapping incremental pulls coalesce**; a broader reason (resume) can follow a sale ACK. Push ∥ pull is unchanged.
6. **Realtime bursts** coalesce (~250–300ms) into one incremental pull.

### Sale ACK before / after

```text
BEFORE:
  upload sale
  → force:true
  → full incremental bundle (~15 sequential entity requests)
  → hospitality + staff + device + PIN

AFTER:
  upload sale (unchanged, local-first)
  → sale_ack (no force)
  → sales incremental pull only (includes sale_line_items for integrity)
```

Network round-trip count for sale ACK reduced from approximately **15–20 sequential requests to 1** (sales). Nested `sale_line_items(*)` remains on that sales query because sale integrity requires lines.

### Resume before / after

```text
BEFORE:
  visibilitychange → pull ("visibility")
  AppState active  → pull ("resume")
  → potentially two force pulls

AFTER:
  both events → one "resume" sync within ~max(visibility, appResume) delay
```

### Pull concurrency before / after

```text
BEFORE: products → customers → sales → … (15 sequential)
AFTER (incremental): up to 4 concurrent independent entity reads, then merge
AFTER (full bootstrap): still sequential (recovery step order preserved)
```

### Shop context before / after

```text
BEFORE: getSession + org/shop resolution on every resolveShopCtx call
AFTER:  first resolve in the tick hits the network; later calls reuse tick context
        tick is cleared at end of the pull bundle
```

### Checkpoint behavior

Independent per-entity cursors. Only entities that **successfully pulled** are advanced. A sale ACK does **not** advance product/customer/stock cursors. Failed entity pulls do not skip ahead.

### Offline behavior

Unchanged: sale writes locally immediately; cashier continues; upload is background.

### Automatic reconnect

Unchanged: `useSyncStatus` still force-pushes and incremental-pulls on network restore.

---

## TEST RESULTS

### Focused (SYNC-1.1)

16/16 targeted assertions across:

- foreground event deduplication
- sale ACK reason-scoped pull / no full bundle / no force
- cached shop context reused
- bounded pull concurrency
- checkpoint patch only for pulled entities
- empty local → bootstrap; synchronized → incremental
- overlapping incremental coalesce + sale_ack→resume upgrade
- realtime burst coalesce

`npm run test:sync` — **47 passed** (plus new files now in the domain map).

### Build

**PASS** (`npm run build` — built in 3.71s)

### Full

**1970 passed / 1 failed / 4 skipped** (367 files: 366 passed, 1 failed)

Unrelated failure (not in this diff):

`src/lib/pharmacyPatientProfile.test.ts` — `computes age from DOB` expected 26, received 25 (`computePatientAge("2000-07-06", new Date("2026-07-06"))`). Pharmacy profile math; **not caused by SYNC-1.1**.

---

## SAFETY

| Guarantee | Status |
|-----------|--------|
| Sale header → lines → stock mutation order | Preserved (push path unchanged) |
| Independent sales still use existing push concurrency | Preserved |
| Upsert idempotency | Preserved |
| RLS / shop isolation | Unchanged |
| Bootstrap full pull when empty / `!bootstrapComplete` / `forceFull` | Preserved (sequential) |
| Recovery lock | Unchanged |
| Offline-first local write | Preserved |
| Staff PIN / device authority on resume/reconnect/startup | Preserved (not on sale ACK) |

---

## REMAINING RISKS

- **No device RTT measurement.** Do not claim “2x faster.” Sale ACK work is architecturally ~15–20 requests → 1. Resume still runs the full incremental bundle, now with bounded parallelism and one trigger.
- Full bootstrap is still a large sequential download by design.
- Nested `sale_line_items(*)` remains on sales incremental pull (integrity).
- Hospitality cursor `waka.hospitality.lastPull` is still not account-scoped (P2 from SYNC-1.0; not required for this repair).
- Mutex reentrancy for nested hydrate-inside-pull is unchanged (intentional for flush-inside-push). Overlapping **incremental** pulls now coalesce instead of dropping.
- Native conservative timing (8s/15s/45s) is unchanged.

No SYNC-1.2 is warranted until a device timing pass shows a remaining bottleneck (likely bootstrap or the resume bundle on large shops).

---

## SYNC-1.1 VERDICT

**GO**

Sync is cheaper, not more frequent. Cashiers still **save locally and continue**; background sync now does less work per sale and no longer double-fires on native resume.
