# STAFF V2 — PHASE 8: REAL SHARED TERMINAL PIN ARCHITECTURE

**Mode:** Architecture audit + implementation plan only. No code. No migration. No SQL. No UI.  
**Date:** 2026-08-23  
**Repo:** pos-waka  
**Live:** `ljaedextsenbkxzzgxcg` (Waka-pos)

**Depends on:** Phases 4–7 complete (160–162). 151–157 unapplied / out of scope.

Legend: **EVIDENCE** · **INFERENCE** · **RECOMMENDATION**

---

# 1. Executive verdict

**B. SAFE WITH SPECIFIC PRECONDITIONS — GO for Phase 8 implementation after approval**

WAKA can connect restaurant-style shared-terminal PIN to real cloud seller attribution **without** replacing Auth, **without** changing `accountKey`, and **without** breaking legacy unlinked PIN — if Phase 8 stays on the **JWT-preserving lock-screen / switch-user path** and does **not** reuse `signInStaff()` as the shared-terminal model.

**Not A:** Today linked PIN still produces `sold_by_user_id = NULL` even when `shop_pos_staff.user_id` is set in cloud, because:
1. Local `StaffAccount` has no linked Auth field.
2. Staff download RPCs omit `user_id`.
3. `cloudSync` only sends `sold_by_user_id` when `sale.soldByUserId` is a UUID; PIN actors are `staff:<id>`.
4. The `created_by` ternary would wrongly attribute the **writer** to the seller if we naively put a linked UUID into `soldByUserId`.

**Not C:** No identity redesign. Columns and Phase 7 validation already exist.

---

# 2. Executive goal (confirmed)

| Today (legacy PIN) | Target (shared terminal) |
|--------------------|--------------------------|
| PIN = fake local identity `staff:<id>` | PIN verifies worker on authenticated device |
| Owner/device JWT often signed out (`signInStaff`) | JWT stays; device remains authorized |
| Seller lost on cloud (`sold_by` NULL) | `sold_by_user_id` = linked `shop_pos_staff.user_id` |
| `created_by` = owner remap or missing JWT | `created_by` = `auth.uid()` writer |

**Rule (unchanged):**

```
JWT authenticates the person/device.
PIN verifies the worker on a shared terminal.
shop_members authorizes the worker.
sold_by_user_id records the commercial seller.
```

PIN must **never** become a replacement for Supabase Auth.

---

# 3. Current architecture — EVIDENCE

## 3.1 Two distinct PIN paths (critical)

### Path L — Dedicated / offline staff login (`signInStaff`)

**EVIDENCE** — `src/hooks/useAuth.ts` `signInStaff`:

```992:1006:src/hooks/useAuth.ts
  const signInStaff = useCallback(async (input: StaffLoginInput) => {
    const auth = await authenticateStaffLogin(input);
    applyAccountSwitchSync(auth.accountKey);
    setSession(null);
    setLocalEmail(null);
    if (hasSupabaseConfig && supabase) {
      await supabase.auth.signOut();
    }
    setStaffSession({
      accountKey: auth.accountKey,
      ...
    });
```

- Verifies PIN via `authenticateOfflineStaff` (`staffOfflineAuth.ts`).
- **Signs out** Supabase Auth.
- Sets `staffSession`; `accountKey` = owner shop ledger (`sb:<owner…>` from staff cache).
- `resolveShopCtx()` requires `supabase.auth.getSession()` → **no JWT → no cloud push** until owner signs in again.

**RECOMMENDATION:** Treat Path L as **legacy dedicated-device / offline-only**. Do **not** make it the Phase 8 shared-terminal architecture. Keep frozen behavior; do not remove `signOut` as a drive-by.

### Path S — Shared terminal lock-screen / switch-user (JWT preserved)

**EVIDENCE** — `sessionActor.ts`:

```64:82:src/lib/sessionActor.ts
  const activeStaff =
    authRole === "owner" && params.preferences.activeStaffId
      ? (params.preferences.staffAccounts ?? []).find(
          (s) => s.id === params.preferences.activeStaffId && s.active,
        )
      : undefined;
  ...
  const userId = activeStaff ? `staff:${activeStaff.id}` : baseUserId;
```

**EVIDENCE** — `staffSwitchUser.ts` / `staffLockScreen.ts`: `performStaffSwitch` / `verifyLockScreenPin` set `preferences.activeStaffId` only — **no** `signOut`.

**EVIDENCE** — `AppShell.tsx`: `resolveSessionActor({ user, staffSession, preferences })` — when `staffSession` is null and owner JWT exists, active staff still yields `staff:<id>`.

This is the restaurant tablet model Phase 8 must complete.

## 3.2 Legacy seller chain (Path S today)

```
Owner JWT (ctx.userId = owner UUID)
        ↓
PIN / switch → activeStaffId
        ↓
SessionActor.userId = staff:<id>
        ↓
usePosStore finalize → sale.soldByUserId = staff:<id>
        ↓
cloudSync:
  created_by = ctx.userId (owner)     // because !isUuid(staff:…)
  sold_by_user_id = null              // same gate
```

**EVIDENCE** — push builder:

```729:730:src/offline/cloudSync.ts
      created_by: sale.soldByUserId && isUuid(sale.soldByUserId) ? sale.soldByUserId : ctx.userId,
      sold_by_user_id: sale.soldByUserId && isUuid(sale.soldByUserId) ? sale.soldByUserId : null,
```

**EVIDENCE** — `StaffAccount` (`types.ts` ~2076): no `userId` / `linkedAuthUserId`.

**EVIDENCE** — `CloudStaffRow` / `cloudRowToStaff` / `shop_pos_staff_download` (migration 125): **no `user_id` in download JSON** even though column exists (158).

## 3.3 Phase 7 server (ready, membership-only)

**EVIDENCE** — `staff_v2_validate_sold_by_user_id` (162): Auth + `shop_members(shop_id, user_id)` → UUID else NULL.  
`p_writer_id` accepted but unused. No `pos_staff_id` proof yet.

If Phase 8 client sends linked cashier UUID while owner JWT writes:

| Field | Expected |
|-------|----------|
| `created_by` | owner (must come from `ctx.userId`, not seller UUID) |
| `sold_by_user_id` | cashier UUID (Phase 7 accepts if member) |

---

# 4. Phase 8 target architecture

## Shared terminal example

```
JWT:           owner@example.com
Device:        Shop A authorized
PIN selects:   John (shop_pos_staff.user_id = John UUID)

Sale write:
  created_by        = owner UUID     (auth.uid / ctx.userId)
  sold_by_user_id   = John UUID      (linked staff)
```

## Identity separation

| Identity | Source | Column | Meaning |
|----------|--------|--------|---------|
| Writer | `auth.uid()` / `ctx.userId` | `sales.created_by` | Device/account authorized to write |
| Seller | `shop_pos_staff.user_id` | `sales.sold_by_user_id` | Employee who sold |

**Never:** replace `created_by` with seller; sign out JWT on switch; invent fake Auth UUIDs; store `staff:<id>` in UUID columns.

---

# 5. Critical design decision — Option A vs B

## Option A (RECOMMENDED) — extend staff selection state; keep `SessionActor.userId = staff:<id>`

Add linked Auth id alongside PIN staff id:

```
StaffAccount.linkedAuthUserId?: string | null   // from shop_pos_staff.user_id
// and/or selection runtime:
{ staffId, linkedAuthUserId }
```

| Benefit | Why |
|---------|-----|
| Minimal blast radius | Local filters / shifts / Home still key on `staff:<id>` |
| Offline | Linked UUID cached with staff row |
| Clear separation | UI actor ≠ commercial Auth seller |
| Matches Phase 10 freeze | `rowToSale` / dashboards untouched |

## Option B — change `SessionActor.userId` to Auth UUID

**Not recommended.** Breaks PIN filters, shift open-by-actor, hospitality waiter ids, offline equality, and Phase 10 cutover assumptions.

## CloudSync mapping change (REQUIRED for Option A)

**Today’s ternary conflates writer and seller** whenever `soldByUserId` is a UUID. That is correct for Phase 6 Auth cashiers (JWT == seller), but **wrong** for shared terminal (JWT == owner, seller == linked staff).

**RECOMMENDATION — Phase 8 payload rule:**

```
created_by        := ctx.userId                    // always JWT writer
sold_by_user_id   := resolveCommercialSeller(sale) // see below
metadata.pos_staff_id := staff row id (optional)
```

`resolveCommercialSeller`:

1. If `isUuid(sale.soldByUserId)` → that UUID (Auth cashier Path / owner selling as self).
2. Else if `sale.soldByUserId` matches `staff:<id>` and that staff has `linkedAuthUserId` → linked UUID.
3. Else → `null` (legacy unlinked PIN).

**Meaning of `created_by`:** still “authenticated writer” — stronger and clearer than the Phase 3 dual-write ternary. Allowed under Phase 8 “cloudSync payload mapping” + “created_by remains writer.”

---

# 6. PIN behavior rules

| Condition | Local actor | Cloud seller |
|-----------|-------------|--------------|
| `linkedAuthUserId` set | `staff:<id>` (UI) | `sold_by_user_id = linkedAuthUserId` |
| `linkedAuthUserId` null | `staff:<id>` | `sold_by_user_id = null` |
| Auth cashier JWT (no PIN) | UUID | UUID (unchanged) |

`signInStaff` Path L: no JWT → cannot push; when owner later syncs, still no linked seller unless sale was created under Path S. Document as known legacy limit.

---

# 7. Offline / accountKey

**EVIDENCE:** Path L already reuses owner `accountKey`. Path S never switches key.

**RECOMMENDATION:** Shared terminal **must not** change `accountKey` on PIN switch.

```
Tablet ledger:  sb:<deviceAuthUser>
Morning John / Afternoon Mary:
  same ledger, different sold_by_user_id
```

Offline sales store `staff:<id>` locally; at push time resolve `linkedAuthUserId` from cached `staffAccounts`. Requires link field present in offline staff cache before offline window (download while online).

---

# 8. Database / RPC requirements

## Schema redesign: none

`shop_pos_staff.user_id` and `sales.sold_by_user_id` already exist.

## Likely small migration 163 (design only — not created)

| Change | Why |
|--------|-----|
| Include `user_id` in `shop_pos_staff_download` / list payloads | Client cannot cache link without it |
| Optional: strengthen Phase 7 validator with `metadata.pos_staff_id` when `p_writer_id ≠ candidate` | Prevents owner device attributing arbitrary shop members without PIN selection proof |

**Do not** weaken Phase 7 membership check.  
**Do not** add invitation tables or rewrite 158–162.

**INFERENCE:** If 163 only adds `user_id` to download JSON, no column migration needed — function replace only.

Optional `pos_staff_id` proof (recommended for P1 security depth):

```
when writer ≠ candidate:
  require metadata.pos_staff_id → shop_pos_staff row
    shop_id = p_shop_id
    user_id = candidate
    is_active
    deleted_at is null
else NULL
```

When writer == candidate (Auth cashier), membership alone remains enough.

---

# 9. Files audit (future implementation scope)

## Allowed (Phase 8)

| Area | Likely touch |
|------|----------------|
| `StaffAccount` + offline cache sanitize | `linkedAuthUserId` |
| `shopStaffCloud.ts` / `staffCacheSync.ts` | Map `user_id` |
| Staff download RPC | Expose `user_id` (163) |
| Lock / switch / session helpers | Carry linked id in selection state |
| `cloudSync` `buildSalePushPayload` / pending | Split writer vs seller; optional `pos_staff_id` |
| Sale finalize (minimal) | Optional `soldByAuthUserId` **or** resolve only at push from staffAccounts |
| Tests | P1–P6 static + throwaway |

## Frozen

| Item | Reason |
|------|--------|
| `signInStaff` Auth sign-out model | Legacy Path L |
| Phase 7 membership core | Do not weaken |
| `sessionActor` `staff:` prefix as primary UI id | Option A |
| `rowToSale`, dashboards, filters | Phase 10 |
| `created_by` **meaning** (writer) | Preserve; only fix payload source |
| Migrations 158–161 | Frozen |
| 151–157 | Out of scope |

---

# 10. Implementation plan (post-approval, ordered)

1. **163 (if needed):** `shop_pos_staff_download` (+ list if used) emit `user_id`; optional validator `pos_staff_id` proof when writer ≠ candidate.
2. **Client link field:** `StaffAccount.linkedAuthUserId`; map in cloud ↔ cache; sanitize for offline cache.
3. **cloudSync:** `created_by = ctx.userId`; `sold_by_user_id = resolveCommercialSeller(...)`; optional metadata `pos_staff_id`.
4. **Path S only:** ensure lock-screen / switch-user path populates / refreshes linked id; **do not** change `accountKey`; **do not** call `signOut` on PIN switch.
5. **Path L:** leave `signInStaff` as-is; document no cloud seller attribution without JWT.
6. **Static + live tests** P1–P6 on throwaway shop.
7. **No** dashboard / `rowToSale` changes.

---

# 11. Security tests required (throwaway shop)

| ID | Setup | Expected |
|----|-------|----------|
| **P1** Linked PIN | Owner JWT + linked cashier PIN (Path S) | `created_by` = owner; `sold_by_user_id` = cashier UUID |
| **P2** Legacy PIN | Unlinked staff | `created_by` = owner; `sold_by` NULL |
| **P3** Wrong shop UUID | Push other-shop member UUID | Phase 7 → NULL; sale OK |
| **P4** Cross-shop PIN | Shop B staff PIN on Shop A device | Local reject (not in `staffAccounts`) |
| **P5** Offline | Linked PIN sale offline → later sync | `sold_by_user_id` = linked UUID |
| **P6** Retry | Existing seller; retry different UUID | Fill-once preserves original |

---

# 12. Success criteria (GO gate)

| Criterion | Gate |
|-----------|------|
| Shared terminal keeps JWT | Path S unlock does not `signOut` |
| PIN does not replace Auth | No Auth session from PIN |
| Linked PIN → real seller UUID | P1 |
| Legacy PIN works | P2 |
| Offline keeps seller | P5 |
| `created_by` = writer | P1 / payload rule |
| `sold_by_user_id` = commercial seller | P1 |
| No `accountKey` collisions | Switch user does not remount ledger |

---

# 13. Risks

| Risk | Mitigation |
|------|------------|
| Putting linked UUID into `soldByUserId` corrupts `created_by` via old ternary | Change payload to always `created_by = ctx.userId` |
| Using `signInStaff` for shared tablets | Explicit Path L vs Path S; Phase 8 owns Path S only |
| Link never downloaded offline | Ensure staff cache includes `user_id` after invite accept / sync |
| Owner forges any shop member as seller | Optional `pos_staff_id` proof in 163 |
| Dashboard still shows owner for PIN sales | Accepted until Phase 10 |

---

# 14. Relationship to adjacent phases

```
Phase 6 ✅  Auth staff independent login
Phase 7 ✅  Server validates sold_by membership
Phase 8 ⏳  Shared terminal PIN → real sold_by (this audit)
Phase 9     Upgrade legacy PIN rows via invite → user_id
Phase 10    rowToSale / dashboards cutover
```

---

```
STOP
NO CODE WRITTEN.
NO MIGRATION CREATED.
NO SQL APPLIED.
NO PIN BEHAVIOR MODIFIED.
WAITING FOR PHASE 8 APPROVAL.
```
