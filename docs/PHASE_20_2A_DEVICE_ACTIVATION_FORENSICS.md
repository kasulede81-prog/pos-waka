# Phase 20.2A — Enterprise Device Activation Failure Forensics

**Mode:** Read-only forensic audit (no code changes, no migrations, no refactoring, no tests modified)  
**Date:** July 2026  
**Evidence:** Production screenshot (Android, 16:59–17:00), repository at Phase 20.2 completion  
**Screenshots:** “Preparing your device” → “Connecting to your shop…” → **“Could not activate this device. Try again.”**

---

## Executive Summary

| Question | Answer |
|----------|--------|
| Is Phase 20.2 routing active? | **Yes** — Primary Device UI gone; `/device-activating` is the new gate |
| Which pipeline step fails? | **Owner auto-approve / activate sub-pipeline** after successful `register` (device remains `pending` + `disconnected`) |
| Most likely failing RPC | **`shop_device_set_approval`** (owner self-approve) or **`shop_device_register_on_login`** re-entry when approve/activate cannot complete |
| Exact client handler | `tryOwnerApproveCurrentDevice()` → `DeviceActivatingPage.runActivation()` → `resolveLoginDeviceActivation()` |
| Why recovery fails | Generic error string hides `failureReason`; retries repeat the same path; **`slotFree` gate skips auto-approve when `fetchShopDeviceLimitContext` fails** |
| Phase 20.2 regression? | **Yes — behavioral regression** from removed owner bypass; real activation now required but pipeline has **fragile gating + SQL/client drift** |
| Minimal fix direction | Remove `limit_context` as hard gate for owner auto-approve; surface RPC errors; align `shop_device_ensure_activation` with migration 138; handle `email_not_verified` on approve |

**Certification:** Pipeline architecture is correct; **reliability is not certified** on Android until the failure branch below is fixed.

---

## PART 1 — Activation Pipeline Trace

### End-to-end flow (Login → POS)

```
LoginPage (owner sign-in)
  ↓ useAuth.onLogin → Supabase auth session
  ↓ Navigate to "/" (LoginPage.tsx:58-59)

ProtectedRoute → BusinessProfileRequiredRoute
  ↓
EmailVerificationGateOutlet (allows /device-activating even if email unverified)
  ↓
DeviceActivationProvider.runCheck(user.id)          [DeviceActivationContext.tsx:97-179]
  ↓ resolvePrimaryOrganizationForUser(uid)          [fetchShopSubscription.ts:6-51]
  ↓ resolveLoginDeviceActivation(shopId)            [deviceActivation.ts:325-371]
      ↓ registerShopDeviceOnLogin                     [deviceActivation.ts:182-189]
          ↓ RPC shop_device_register_on_login         [migration 138]
      ↓ (if !activated && owner && slotFree)
          runOwnerActivationPipeline                  [deviceActivation.ts:283-307]
            ↓ tryOwnerApproveCurrentDevice            [deviceActivation.ts:223-281]
                ↓ fetchShopDeviceLimitContext         → RPC shop_device_limit_context
                ↓ fetchShopDevicesForManagement       → RPC owner_list_shop_devices
                ↓ registerShopDeviceOnLogin (if needed)
                ↓ setDeviceApprovalStatus("approved") → RPC shop_device_set_approval [migration 133]
                ↓ ensureShopDeviceActivation          → RPC shop_device_ensure_activation [migration 090 — STALE]
      ↓ refreshDeviceAuthorityContext                 [deviceAuthority.ts:186-193]
          ↓ RPC shop_device_context                   [migration 138]

DeviceActivationGateOutlet                          [DeviceActivationGateOutlet.tsx]
  ↓ if block.kind === "activating" | "error"
      Navigate → /device-activating

DeviceActivatingPage                                [DeviceActivatingPage.tsx]
  ↓ resolveLoginDeviceActivation (auto-retry 8× / 2.5s + manual Try again)
  ↓ on success: retry() + navigate "/"
  ↓ on limit: /device-limit
  ↓ on revoked: /device-pending
  ↓ else: setError("Could not activate this device. Try again.")

DeviceActivationGateOutlet (activated=true)
  ↓ Outlet → AppShell / POS routes
```

### Step-by-step table

| Step | Caller | File | Expected | Failure | Fallback | Retry |
|------|--------|------|----------|---------|----------|-------|
| Resolve org | `DeviceActivationProvider.runCheck` | `DeviceActivationContext.tsx:102` | `{ shopId }` | `null` → `activated=true` (no cloud shop) | Skip device gate | On `retry()` |
| Register on login | `resolveLoginDeviceActivation` | `deviceActivation.ts:331` | `{ ok:true, activated:true }` or pending | RPC throw → `{ failureReason: rpc_failure }` | Route `/device-activating` | 3× in pipeline + page retries |
| Limit context | `resolveLoginDeviceActivation` | `deviceActivation.ts:353` | `{ is_owner, at_limit }` | **Caught; `context=null`** | **`slotFree=false` → skip auto-approve** | None |
| Owner auto-approve | `runOwnerActivationPipeline` | `deviceActivation.ts:360-366` | `activatedResult.activated` | `tryOwnerApprove` returns `false` | Stay blocked | 3× backoff `[0,400,1200]ms` |
| Find device row | `tryOwnerApproveCurrentDevice` | `deviceActivation.ts:233-244` | Row with matching fingerprint | `!mine` → `false` | Re-register | Re-register once |
| Set approval | `setDeviceApprovalStatus` | `deviceAuthority.ts:232-253` | `{ ok:true }` | `{ ok:false, error }` incl. `email_not_verified`, `approval_expired`, `device_limit_reached` | Log + return false | Re-register + retry approve |
| Ensure activation | `ensureShopDeviceActivation` | `deviceActivation.ts:171-179` | `{ activated:true }` | RPC throw or pending | Return false | Next pipeline iteration |
| Refresh authority | `refreshDeviceAuthorityAfterActivation` | `deviceActivation.ts:162-168` | Cache updated | **Caught; logged only** | Stale cache possible | Page `retry()` |
| Gate route | `DeviceActivationGateOutlet` | `DeviceActivationGateOutlet.tsx:43-44` | `/device-activating` | N/A | Default → activating | Page auto-retry |
| Page error UI | `DeviceActivatingPage.runActivation` | `DeviceActivatingPage.tsx:63` | Navigate `/` | **`deviceActivatingFailedRpc`** | Manual Try again | 8 auto + manual |

### Screenshot correlation

| UI copy | Source | Meaning |
|---------|--------|---------|
| “Preparing your device” | `deviceActivatingPreparing` | `attempt ≤ 2` — early retries (`DeviceActivatingPage.tsx:23-26`) |
| “Connecting to your shop…” | `deviceActivatingConnecting` | `attempt ≤ 5` — **register likely succeeded**; approve/activate still failing |
| “Could not activate this device. Try again.” | `deviceActivatingFailedRpc` | `failureReason` ∈ `{ rpc_failure, pending_approval, unknown }` — **not** `approval_denied`, **not** timeout/network |

The approval-specific string (`deviceActivatingFailedApproval`) is **not** shown, which rules out the common path where `fetchShopDeviceLimitContext` succeeds and `tryOwnerApproveCurrentDevice` fails after an explicit approve attempt.

---

## PART 2 — RPC Audit

| RPC | Introduced | Latest replacement | Calls from client | Still executable? |
|-----|------------|-------------------|-------------------|-------------------|
| `shop_device_register_on_login` | 089 | **138** (approval-based, no primary) | `deviceActivation.ts:185` | ✅ Current if migration 138 applied |
| `shop_device_ensure_activation` | 090 | **None — still 090 definition** | `deviceActivation.ts:175` | ⚠️ **Stale** — checks `status='active'` only, ignores `approval_status` |
| `shop_device_set_approval` | 124 | **133** (owner-only, no actor-primary; email verify) | `deviceAuthority.ts:238` | ✅ Current if migration 133 applied |
| `shop_device_context` | 123 | **138** (approval-based `is_device_authorized`) | `deviceAuthority.ts:170` | ✅ |
| `shop_device_limit_context` | 090 | **138** (sort by `last_seen_at`) | `deviceActivation.ts:381` | ✅ |
| `owner_list_shop_devices` | 088 | **136** (pending sort; legacy JSON echo) | `shopDevices.ts:129` | ✅ |

### `shop_device_register_on_login` (138)

**Validation (lines 238–241):**
```sql
if v_fp is null or length(v_fp) < 8 then
  raise exception 'Invalid device fingerprint';
end if;
```

**Success payloads:**
- Active + approved: `{ ok:true, activated:true, existing_device:true }`
- First shop device: auto-approved active insert
- Additional device: `{ ok:true, activated:false, pending_approval:true, approval_status:'pending', status:'disconnected' }`
- Limit: `{ ok:false, limit_blocked:true, activated:false }`
- Revoked: `{ ok:false, revoked:true, activated:false }`

**Error payload:** Postgres `EXCEPTION` → Supabase `{ message: "Invalid device fingerprint" | "Forbidden" | ... }`

### `shop_device_set_approval` (133)

**Requires:** `require_verified_email_for_cloud()` (migration 095)

**Failure payloads:**
- `{ ok:false, error:'approval_expired' }` — pending row **deleted** (TTL **1 minute**, migration 133)
- `{ ok:false, limit_blocked:true, error:'device_limit_reached' }`
- `{ ok:false, error:'device_not_found' }`
- Exception: `email_not_verified`, `Forbidden`

**Success:** `{ ok:true, approval_status:'approved' }` + sets `status='active'`

### `shop_device_ensure_activation` (090 — NOT updated in 138)

```518:561:supabase/migrations/090_device_limit_enforcement.sql
  if v_status = 'active'::public.shop_device_status then
    return jsonb_build_object('ok', true, 'activated', true, ...);
  end if;
  return public.shop_device_register_on_login(...);
```

**Gap:** Returns `activated:true` for `status='active'` even if `approval_status='pending'` (invalid composite state). Does not independently promote `disconnected+approved` — delegates to register.

### Old RPC risk

No dropped RPC names in client. Risk is **stale function body** (`shop_device_ensure_activation`) not missing function.

---

## PART 3 — Failure Matrix

| Condition | RPC / result | Client reaction | Screen | Retry? | Recoverable? |
|-----------|--------------|-----------------|--------|--------|--------------|
| Invalid fingerprint (`length < 8`, e.g. `"unknown"`) | register **throws** | `failureReason: rpc_failure` | `/device-activating` + RPC error | Auto 8× | ❌ until fingerprint fixed |
| Network / fetch error | RPC throw | `network` or `rpc_failure` | `/device-activating` | Yes | ✅ transient |
| 30s activation timeout | `withTimeout` fallback | `timeout` | `/device-activating` + timeout msg | Yes | ✅ |
| Device limit | `{ limit_blocked:true }` | Navigate `/device-limit` | Device Limit | Manual replace | ✅ owner action |
| Revoked device | `{ revoked:true }` | `/device-pending` | Pending (revoked) | Manual | ⚠️ owner must re-add |
| Pending (staff) | `{ pending_approval:true }` | `/device-pending` | Pending | Manual approve | ✅ |
| Pending (owner, slot free) | register pending | `block.kind=activating` | **Preparing** | Auto pipeline | ✅ if approve succeeds |
| **`limit_context` fetch fails** | N/A (client) | **`slotFree=false` → skip auto-approve** | `/device-activating` + **RPC error** | Yes (same skip) | ❌ stuck loop |
| **`set_approval` email not verified** | Exception `email_not_verified` | `approval_denied` | `/device-activating` + **approval error msg** | Yes (same fail) | ✅ verify email |
| **`set_approval` approval expired** | `{ error:'approval_expired' }` | `approval_denied` (if context ok) | Approval or RPC msg | Re-register pending | ⚠️ 1-min TTL race |
| **`set_approval` limit at approve time** | `{ limit_blocked:true }` | `approval_denied` or `pending_approval` | `/device-activating` or limit | Yes | ✅ free slot |
| **`tryOwnerApprove` !mine** | N/A | `approval_denied` or false pipeline | `/device-activating` | Yes | ⚠️ list/register desync |
| Ensure returns pending after approve | register pending branch | Pipeline retry | `/device-activating` | 3× pipeline | ⚠️ SQL/state |
| Authority refresh fails | caught in refresh | **`activated` may still be true** | POS with stale auth | Background | ⚠️ partial |
| Migration 138 not applied | register behavior differs | Unpredictable | varies | Yes | ❌ deploy mismatch |

---

## PART 4 — Android vs Web

| Factor | Web | Android (Capacitor WebView) | Risk |
|--------|-----|----------------------------|------|
| Device ID storage | `localStorage` key `waka-pos-device-id` | Same API via WebView | Shared |
| ID generation | `crypto.randomUUID()` (36 chars) | Same | Low |
| **Storage failure fallback** | Returns **`"unknown"` (7 chars)** | Same code | **HIGH — fails RPC validation** |
| Fingerprint stability | Stable unless clear site data | Stable unless clear app data / reinstall | New device row (pending), not RPC error |
| Platform label | `"web"` | `"android"` via `Capacitor.getPlatform()` | Cosmetic |
| Capacitor Preferences | Not used for device ID | Not used | Missed native persistence option |
| Pending TTL | 1 minute (server) | Same | Retries >1 min lose pending row |
| Service worker | PWA may cache bundle | Native APK bundle | Stale client if old APK |

**Can Android generate a different fingerprint unexpectedly?**  
Only if `localStorage` is cleared, app data cleared, or reinstall — then **new UUID**, not `"unknown"`. Unexpected **invalid** fingerprint requires `getOrCreateDeviceId()` catch path (`deviceId.ts:12-13`).

```4:14:src/lib/deviceId.ts
export function getOrCreateDeviceId(): string {
  ...
  } catch {
    return "unknown";
  }
}
```

---

## PART 5 — Authority Refresh

```
Activation success (resolveLoginDeviceActivation)
  ↓ refreshDeviceAuthorityContext(shopId)     [deviceActivation.ts:162-168]
      ↓ fetchDeviceAuthorityContext(force)      [deviceAuthority.ts:186-193]
          ↓ RPC shop_device_context
          ↓ write localStorage waka.device.authority.v2
          ↓ notifyAuthorityRefreshListeners()
  ↓ DeviceActivationProvider.finalizeActivation [DeviceActivationContext.tsx:83-87]
  ↓ setActivated(true)

DeviceAuthorityProvider (wraps all gated routes)  [DeviceAuthorityBridge.tsx]
  ↓ fetchDeviceAuthorityContext on mount + subscribe refresh
  ↓ isDeviceAuthorized = operational && approved

DeviceApprovedGate (Staff, Backup, etc.)          [DeviceApprovedGate.tsx]
  ↓ Blocks if pendingApproval || !isDeviceAuthorized
```

**Can activation succeed but authorization stay stale?**

| Scenario | Possible? | Evidence |
|----------|-----------|----------|
| `activated=true` but authority cache false | **Unlikely at gate** — both refreshed before `setActivated(true)` | `DeviceActivationContext.tsx:121-125` |
| Refresh throws after DB activated | **Yes** — error swallowed | `deviceActivation.ts:166-168` catch only logs |
| Strict cache cold start (Phase 20.2) | **Yes on partial success** | `isDeviceAuthorizedForManagementSync()` false when cache null |
| User stuck on `/device-activating` | **`activated=false`** — authority not the primary blocker | Screenshot state |

**Conclusion:** Stale authority can affect post-login management actions, but **the screenshot failure is pre-activation** (`activated=false`), not authority refresh alone.

---

## PART 6 — Deployment Audit

| Mismatch type | Symptom | Verification |
|---------------|---------|--------------|
| Client ≥138 SQL, DB <138 | Pending approval on 2nd device; auto-first-device differs | Supabase: `select prosrc from pg_proc where proname='shop_device_register_on_login'` — check for `pending_approval` branch |
| DB ≥138, client stale APK | Old routing (Primary Device) — **not this case** | APK `versionCode 18` in repo; confirm device build |
| **`ensure_activation` never migrated** | Approve succeeds but ensure/register round-trip flaky | Function body only checks `status`, not `approval_status` |
| Missing 133 email gate | Approve fails `email_not_verified` | Check `auth.users.email_confirmed_at` |
| Pending TTL 133 not applied | No expiry — different failure mode | Check `shop_device_pending_approval_ttl()` returns `1 minute` |

**Version compatibility checks (read-only):**

1. **Client:** Settings → app version / `VITE_APP_VERSION` / Android `versionCode 18`
2. **Database:** Latest migration ≥ **138** on remote Supabase
3. **RPC spot check:** Call `shop_device_limit_context` + `shop_device_register_on_login` from SQL editor as owner
4. **Device row:** `select status, approval_status, approval_requested_at from shop_devices where device_fingerprint = '<fp>'`
5. **Logs:** Chrome remote inspect WebView → filter `[waka-device-activation]`

---

## PART 7 — Runtime Diagnostics

| Source | Location | Production? | Useful for root cause? |
|--------|----------|-------------|------------------------|
| `console.info` stage logs | `deviceActivationDiagnostics.ts:24-27` | **DEV only** | ❌ on Android release |
| `console.warn` failure logs | `deviceActivationDiagnostics.ts:30-35` | **Yes** | ✅ `[waka-device-activation] approve_failed approval_denied` |
| Supabase RPC error message | Returned to client, often **not shown in UI** | Yes | ⚠️ masked by generic copy |
| Toast | Not used on activating page | — | ❌ |
| `DeviceActivatingPage` error | Shows i18n key only | Yes | ⚠️ coarse mapping |
| Android logcat / WebView inspect | Manual | Yes | ✅ required today |

**Existing logs are insufficient for owners** — failures are logged to console but UI shows generic RPC message. **Remote WebView debugging is required** to identify the failing RPC without new instrumentation.

---

## PART 8 — Root Cause Ranking

| Rank | Cause | Probability | Evidence |
|------|-------|-------------|----------|
| **1** | **Owner auto-approve skipped because `fetchShopDeviceLimitContext` failed → `context=null` → `slotFree=false`** | **High** | `deviceActivation.ts:352-360` — failure caught, pipeline skipped; `resolveFailureReason` with `context=null` + pending → **`pending_approval`** → **`deviceActivatingFailedRpc`** (matches screenshot) |
| **2** | **`shop_device_set_approval` blocked by `email_not_verified`** while `/device-activating` is allowed pre-verify | **Medium** | `133` requires verified email; `EmailVerificationGateOutlet.tsx:24-25` allows `/device-activating`; would show **approval** message if context loaded — less likely given screenshot |
| **3** | **Pending approval 1-minute TTL expiry during retry loop** | **Medium** | `133` TTL = 1 minute; screenshot ~16:59→17:00; `approval_expired` deletes row; pipeline keeps failing |
| **4** | **`tryOwnerApproveCurrentDevice` cannot find device row after register** | **Medium** | `deviceActivation.ts:244` `if (!mine) return false`; `fetchShopDevicesForManagement` swallows Forbidden as empty |
| **5** | **Stale `shop_device_ensure_activation` (090) vs 138 register semantics** | **Medium** | Never replaced after 138; approval-blind early return on `status='active'` |
| **6** | **Invalid fingerprint `"unknown"` (localStorage failure)** | **Low–Medium** | 7 chars < 8 min; register throws → `rpc_failure` — would fail from attempt 1 with no DB row |
| **7** | Authority refresh stale after success | **Low** | User not reaching POS — pre-activation failure |
| **8** | Migration not applied | **Low** | Phase 20.0 docs state 136+138 applied; old Primary UI gone confirms new client |
| **9** | Android fingerprint random change | **Low** | Would create new pending device, not RPC invalid error |

**Do not treat as primary without logs:** network timeout (would show timeout string), device limit (would route `/device-limit`).

---

## PART 9 — Recommended Fix (design only — do NOT implement in 20.2A)

**Smallest fix preserving Phase 20.2 architecture:**

1. **Decouple auto-approve from `limit_context` success** — if `register` returns `pending_approval`, call `tryOwnerApproveCurrentDevice` when `AUTO_APPROVE_DEVICE_ON_OWNER_LOGIN` is true; use limit context only for `/device-limit` routing, not for skipping the pipeline (`deviceActivation.ts:358-360`).

2. **Surface RPC error in UI** — pass `set_approval` / register `error.message` to `DeviceActivatingPage` (still one screen, no redesign).

3. **Email verification guard** — if approve fails with `email_not_verified`, redirect to `/verify-email` instead of infinite `/device-activating`.

4. **SQL: replace `shop_device_ensure_activation`** with 138-aware version (check `shop_device_is_operational(approval_status, status)`).

5. **Device ID hardening (Android)** — never return `"unknown"`; use Capacitor Preferences fallback; pad to ≥8 chars before RPC.

6. **Optional:** Extend pending TTL for owner self-approval on same session (SQL) or approve synchronously in first login response path.

**No redesign. No new features. No refactor beyond the above.**

---

## PART 10 — Production Certification

| # | Question | Answer |
|---|----------|--------|
| 1 | Why does Android stop at Preparing your device? | `DeviceActivationGateOutlet` routes to `/device-activating` when `block.kind === "activating"` — owner has a **pending/disconnected device** and cloud activation has not returned `activated:true`. |
| 2 | Which exact step failed? | **`runOwnerActivationPipeline` / `tryOwnerApproveCurrentDevice`** after successful register — not login, not routing, not Primary Device gate. |
| 3 | Which RPC failed? | **Most likely:** none threw visibly to UI; **`shop_device_set_approval`** if approve ran; **`shop_device_limit_context`** if fetch failed (skip path). Confirm via `[waka-device-activation]` WebView logs. |
| 4 | Which file handled it? | `DeviceActivatingPage.tsx:63` (error display); `deviceActivation.ts:360-370` (pipeline exit); `deviceActivation.ts:223-281` (approve). |
| 5 | Why wasn’t recovery successful? | Auto-retry repeats **`resolveLoginDeviceActivation`** with same **`slotFree`** gate; generic error hides actionable cause; 1-min pending TTL can delete row mid-recovery. |
| 6 | Is the database correct? | **Likely yes** if migrations **133 + 138** applied; **`shop_device_ensure_activation` is outdated** but not sole cause. |
| 7 | Is the client correct? | **Phase 20.2 routing correct**; **pipeline gating fragile** (`limit_context` dependency, coarse errors, email/approve split). |
| 8 | Is deployment mismatched? | **Possible** on `ensure_activation` drift; **unlikely** on register (old UI gone). Verify remote migration ≥138. |
| 9 | Phase 20.2 regression? | **Yes** — removal of owner bypass exposes real activation failures that were previously masked as success. |
| 10 | Minimal path to 10/10 reliability? | Fix items in Part 9 (1–5); add production-safe activation error surfacing; verify email before or during owner approve. |

---

## Bug Report Summary

| Classification | Verdict |
|----------------|---------|
| Routing / Phase 20.2 UI | ✅ Working — correct `/device-activating` |
| Register RPC | ✅ Likely working — “Connecting…” implies past first register |
| Owner auto-approve pipeline | ❌ **Failing** — primary defect zone |
| Authority refresh | ⚠️ Secondary — not blocking entry in this screenshot |
| Enterprise reliability | ❌ **Not certified** |

**Single root cause for implementation phase:**  
The owner activation pipeline **does not reliably execute auto-approve** when `fetchShopDeviceLimitContext` fails or when **`shop_device_set_approval` cannot complete**, leaving the device in **`pending` + `disconnected`** while `/device-activating` shows a **generic RPC error** with no recovery path.

---

## Verification

- ✅ Read-only — no code, SQL, migration, or test changes  
- ✅ All conclusions tied to cited files and migrations  
- ✅ Screenshot error string mapped to `failureReason` code paths  

**Next phase (proposed 20.2B):** Implement Part 9 minimal fixes only.
