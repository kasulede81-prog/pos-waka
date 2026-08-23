# STAFF V2 — PHASE 10: SELLER IDENTITY READ MODEL CUTOVER AUDIT

**Mode:** Architecture audit + implementation plan only  
**Date:** 2026-08-23  
**Repo:** pos-waka  
**Live:** `ljaedextsenbkxzzgxcg` (Waka-pos)  
**Verdict:** **GO for TypeScript-only cutover — no SQL / no RPC / no push changes**

---

## Executive summary

Write path (Phases 7–9) already stores commercial sellers in `sales.sold_by_user_id`. The UI still reconstructs seller as **`created_by`** on pull and filters with **`sale.soldByUserId === actor.userId`**.

Phase 10 is a **read-model cutover**:

| Layer | Today | Target |
|-------|-------|--------|
| Pull `rowToSale` | `soldByUserId ← created_by` | Prefer `sold_by_user_id`, else legacy fallback |
| Merge | Recency may drop remote seller; `soldByAuthUserId` not merged | Commercial seller survives |
| Filters | Strict `=== actor.userId` | Match Auth UUID **or** Path S `linkedAuthUserId` |
| Labels | `staff:` + owner UUID only | Resolve Auth UUID via `StaffAccount.linkedAuthUserId` |

**No migration required.** Pull already uses `select("*")` — `sold_by_user_id` is present but ignored.

---

## Completed write architecture (frozen)

```
auth.users → shop_members → shop_pos_staff.user_id → sales.sold_by_user_id
created_by = JWT writer (Phase 8)
sold_by_user_id = commercial seller (Phase 7 validated)
```

Do **not** modify: migrations 158–164, push mapping, SessionActor, PIN/Auth flows, sale RPCs.

---

## 1. Audit: `rowToSale`

**Location:** `src/offline/cloudSync.ts` (~340–384), used by full/incremental pull and push-ack parse.

```367:367:src/offline/cloudSync.ts
    soldByUserId: (row.created_by as string | null) ?? null,
```

**Evidence:**

- Pull: `.select("*, sale_line_items(*)")` — cloud `sold_by_user_id` arrives on `row` but is discarded.
- Local offline sales keep `soldByUserId = staff:<client_id>` and may stamp `soldByAuthUserId` (Phase 8).
- After pull of a shared-terminal / Auth sale, UI seller becomes **owner UUID** (writer), not cashier.

### Target mapping (recommended)

```ts
// Pseudocode — do not implement until approved
const soldByCloud = isUuid(row.sold_by_user_id) ? row.sold_by_user_id : null;
soldByUserId: soldByCloud ?? (row.created_by as string | null) ?? null,
soldByAuthUserId: soldByCloud, // optional but keeps dual-field honest after pull
// Optional audit field (only if UI needs "Created by"):
// createdByUserId: row.created_by ?? null
```

| Case | Cloud | Local after pull |
|------|-------|------------------|
| Auth / shared terminal | `sold_by` = cashier UUID | `soldByUserId` = cashier |
| Legacy PIN (`sold_by` NULL) | `created_by` = owner | Fallback = owner (same as today) |
| Pure offline never synced | n/a | Keep `staff:<id>` |

**Do not** invent UUID from `staff:` on historical NULL `sold_by` rows.

**Offline impact:** Local-only `staff:` sales untouched until pull. After pull of attributed sales, `soldByUserId` becomes Auth UUID — filters must grow Path S compatibility (below).

---

## 2. Audit: `saleFinancialMerge`

**Location:** `src/lib/saleFinancialMerge.ts`

```103:103:src/lib/saleFinancialMerge.ts
    soldByUserId: meta.soldByUserId ?? financialBase.soldByUserId,
```

`meta` = newer by `updatedAt`. Financial headers stay immutable (good). Gaps:

1. **No commercial preference** — if local is newer with `staff:` and remote has Auth UUID seller, recency can keep `staff:` and hide cloud truth (or the reverse).
2. **`soldByAuthUserId` never merged** — only survives via `...financialBase` spread; remote fill-once `NULL → UUID` can be dropped when local is financial base.
3. Static Phase 5/6 tests assert `MERGE` has no `sold_by_user_id` string — they mean no **cloud column** in merge (correct); Phase 10 still updates **Sale field** merge rules.

### Required merge rule

Prefer commercial Auth seller when either side has a UUID seller:

```
soldByUserId =
  firstUuid(remote.soldByUserId, remote.soldByAuthUserId,
            local.soldByUserId, local.soldByAuthUserId)
  ?? meta.soldByUserId ?? financialBase.soldByUserId

soldByAuthUserId =
  firstUuid(remote.soldByAuthUserId, remote.soldByUserId if uuid,
            local.soldByAuthUserId, …)
```

Remote truth for `sold_by_user_id` must survive R5.

---

## 3. Audit: cashier filters & dashboards

### Personal scope (strict equality today)

| Call site | Pattern |
|-----------|---------|
| `homeVisibility.filterSalesForHomeScope` | `s.soldByUserId === actorUserId` |
| `homeVisibility.filterReturnsForHomeScope` | same |
| `todaySalesSummary` | optional `soldByUserId` filter |
| `PosPage` cashier today | `summarizeTodaySales(..., { soldByUserId: actor.userId })` |
| `ReceiptsPage` non-owner | `s.soldByUserId === actor.userId` |
| `receiptContextHelpers` cashier name shortcut | `sale.soldByUserId === actor.userId` |
| `useHomeDashboardMetrics` / `useShopReporting` | via `filterSalesForHomeScope` |
| Pharmacy / Hospitality dashboards | via `filterSalesForHomeScope` |

### Why equality breaks after a correct pull

| Path | `actor.userId` | Sale after Phase 10 pull | Strict `===` |
|------|----------------|--------------------------|--------------|
| Auth cashier (Path A) | Auth UUID | Auth UUID | OK |
| Shared terminal linked (Path S) | `staff:<id>` | Auth UUID | **FAIL unless filter widened** |
| Legacy PIN unlinked | `staff:<id>` | owner (`created_by` fallback) | FAIL (same as today — preserve) |

### Required filter helper (centralize)

```ts
saleSoldByMatchesActor(sale, actor): boolean {
  const sold = sale.soldByUserId?.trim() ?? "";
  if (!sold) return false;
  if (sold === actor.userId) return true;
  const commercial = commercialAuthUserIdFromActor(actor);
  if (commercial && sold === commercial) return true;
  if (sale.soldByAuthUserId && commercial && sale.soldByAuthUserId === commercial) return true;
  return false;
}
```

Point Home / today / Receipts / returns personal scope at this helper. **Do not** change `SessionActor.userId` (`staff:` stays).

### Owner / shop-wide

`scope === "shop_wide"` returns all sales — totals unchanged (R6). Only attribution labels change when seller UUID resolves to a name.

---

## 4. Seller display rules

### Labels gap

`buildSoldByNameByUserId` maps:

- `staff:${staff.id}` → name  
- owner UUID → shop/owner label  
- **Missing:** `staff.linkedAuthUserId` → name  

After cutover, Auth seller UUIDs fall through to shop/owner label → **wrong “seller = owner”**.

**Fix:** for each `StaffAccount` with `linkedAuthUserId`, `map.set(linkedAuthUserId, name)`.

### Display matrix

| Scenario | `created_by` | `sold_by_user_id` | UI seller | Writer |
|----------|--------------|-------------------|-----------|--------|
| Auth staff sale | cashier | cashier | Cashier | same |
| Shared terminal | owner | cashier | Cashier (not owner) | optional “Created by” |
| Legacy PIN | owner | NULL | Fallback (today: owner / shop) | n/a |
| Offline PIN local | — | — | `staff:` name | — |

Optional: add `Sale.createdByUserId` from `created_by` **only** if product wants explicit “Created by” on receipts. Not required for R1–R8 if seller label alone is fixed.

---

## 5. Migration requirement

| Question | Answer |
|----------|--------|
| New SQL? | **No** |
| RPC change? | **No** |
| Column change? | **No** — `sold_by_user_id` exists (158/159) |
| History rewrite? | **No** |
| Scope | TypeScript read path only |

---

## 6. Implementation plan (after approval)

### Step 1 — Pull mapping

Change `rowToSale` only (still inside `cloudSync.ts`): prefer `sold_by_user_id`; set `soldByAuthUserId` when present. Leave push builders frozen.

### Step 2 — Merge

Update `mergeCompletedSaleMetadata` to prefer commercial UUID seller + merge `soldByAuthUserId`.

### Step 3 — Match helper

Add `saleSoldByMatchesActor` (e.g. `src/lib/sellerIdentity.ts` or next to `homeVisibility.ts`). Wire:

- `homeVisibility` filters  
- `todaySalesSummary` / PosPage cashier  
- `ReceiptsPage`  
- `receiptContextHelpers` equality shortcut  

### Step 4 — Labels

Extend `buildSoldByNameByUserId` with `linkedAuthUserId` → name.

### Step 5 — Reports that group by `soldByUserId`

Review (usually auto-fixed once pull is correct):

- `cashPosition.ts` cashier agg  
- `monthlyBusinessReport.ts` / `salesDayIndex.ts`  
- `analyticsPageView.ts` / Enterprise reports  

No backend reporting RPC changes in Phase 10.

### Step 6 — Tests R1–R8 + static freeze checks

Update Phase 8 static test that currently freezes  
`soldByUserId: (row.created_by …)` — replace with Phase 10 prefer-`sold_by` assertion.

---

## 7. Required tests

| ID | Scenario | Expected |
|----|----------|----------|
| **R1** | `created_by=owner`, `sold_by=cashier` | UI seller = cashier name |
| **R2** | Shared terminal same shape | Seller = cashier; writer ≠ seller if labeled |
| **R3** | `sold_by` NULL | No crash; legacy fallback |
| **R4** | Local `soldByUserId=staff:<id>` | Still visible to that Path L/S actor via `===` |
| **R5** | Merge remote NULL→UUID | Local gains seller UUID |
| **R6** | Owner shop-wide totals | Unchanged vs before |
| **R7** | Receipts | Seller name + cashier filter |
| **R8** | Home / today / reports | Personal scope + staff totals by commercial seller |

Prefer vitest fixtures over live SQL (no DB change). Optional throwaway pull fixture if needed.

---

## 8. Files likely affected

| File | Role |
|------|------|
| `src/offline/cloudSync.ts` | `rowToSale` only |
| `src/lib/saleFinancialMerge.ts` | Seller field survival |
| `src/lib/homeVisibility.ts` | Personal filters |
| `src/lib/todaySalesSummary.ts` | Optional; or pass match helper from callers |
| `src/pages/PosPage.tsx` | Cashier today filter |
| `src/pages/ReceiptsPage.tsx` | Cashier receipts filter |
| `src/lib/receiptContextHelpers.ts` | Cashier label equality |
| `src/lib/soldByLabels.ts` | Auth UUID → name |
| New helper + `*.test.ts` | Match + rowToSale + merge |
| `cashPosition` / reports | Verify after pull fix |

**Frozen:** 158–164, invite/Auth/PIN, `sessionActor` identity prefix, push `created_by` / `sold_by_user_id`, Phase 7 validator.

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Path S after pull: UUID vs `staff:` | `saleSoldByMatchesActor` |
| Auth UUID shows as owner | Map `linkedAuthUserId` in labels |
| Merge drops remote seller | Prefer UUID seller fields |
| Double-count if both `staff:` and UUID rows | One sale id; mapping replaces field, does not duplicate |
| History NULL `sold_by` | Explicit fallback; never invent |

---

## 10. Success criteria

Phase 10 GO when:

- Auth cashier: personal Home/Receipts match `sold_by_user_id`
- Shared terminal linked PIN: seller display = cashier, not owner
- Legacy unlinked: behavior unchanged (no crash, no invented UUID)
- Owner shop-wide totals unchanged
- Push / SessionActor / PIN / migrations untouched

---

## STOP

**NO CODE WRITTEN.**  
**NO MIGRATION CREATED.**  
**NO SQL APPLIED.**  
**NO UI MODIFIED.**

**WAITING FOR PHASE 10 APPROVAL.**
