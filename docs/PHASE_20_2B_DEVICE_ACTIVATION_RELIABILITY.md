# Phase 20.2B — Enterprise Device Activation Reliability

**Date:** July 2026  
**Status:** Complete  
**Foundation:** Phase 20.0, 20.1A, 20.2, 20.2A  
**Build:** `npm run build` ✅  
**Tests:** `npm test` ✅

---

## 1. Activation Reliability Report

### Issues fixed

| Issue | Root cause (20.2A) | Fix |
|-------|-------------------|-----|
| Generic “Could not activate this device” | `slotFree` skipped owner pipeline when `limit_context` failed | Auto-approve runs when register returns pending — **not gated on limit_context success** |
| Wrong Device Limit redirect | `context.at_limit` forced `/device-limit` even for pending owner activation | Limit routing only when `kind === "limit"` from **register `limit_blocked`** or explicit failure reason |
| Email verify invisible | `set_approval` requires verified email; UI showed generic RPC error | **`email_not_verified`** failure kind + enterprise copy + **Verify email** link |
| Pending 1-minute expiry race | SQL TTL = 1 min; slow Android retries lost pending row | TTL extended to **15 minutes** (migration 139); client re-registers on `approval_expired` before retry approve |
| Stale `shop_device_ensure_activation` | Migration 090 checked `status` only | Migration **139** uses `shop_device_is_operational(approval_status, status)` |
| Invalid Android fingerprint | `localStorage` failure returned `"unknown"` (7 chars) | `getOrCreateDeviceId()` always returns UUID ≥ 8 chars |
| Poor diagnostics | Stage logs DEV-only; coarse UI errors | Production **`logActivationAttempt`** with shop/device/RPC/elapsed/failure; precise i18n messages |

### Runtime path (verified)

```
Owner Login
  → DeviceActivationProvider.runCheck
  → resolveLoginDeviceActivation
      → registerShopDeviceOnLogin (RPC 138)
      → if pending && AUTO_APPROVE:
          runOwnerActivationPipeline
            → tryOwnerApproveCurrentDevice
                → owner_list_shop_devices (find row)
                → shop_device_set_approval (if pending)
                → shop_device_ensure_activation (RPC 139)
      → refreshDeviceAuthorityContext
  → DeviceActivationGate → POS
```

---

## 2. RPC Certification

| RPC | Responsibility | Client caller | Migration |
|-----|----------------|---------------|-----------|
| `shop_device_register_on_login` | Register/update device row; first device auto-approved; additional → pending | `registerShopDeviceOnLogin` | 138 |
| `shop_device_set_approval` | Owner approve/revoke; sets active on approve; requires verified email | `setDeviceApprovalStatus` | 133 |
| `shop_device_ensure_activation` | Promote to operational if approved+active; else delegate to register | `ensureShopDeviceActivation` | **139** (was 090) |
| `shop_device_limit_context` | Plan limit, active count, owner flag — **routing hint only** | `fetchShopDeviceLimitContext` | 138 |
| `shop_device_context` | Device authority cache | `fetchDeviceAuthorityContext` | 138 |
| `owner_list_shop_devices` | Find pending/approved row for current fingerprint | `fetchShopDevicesForManagement` | 136 |

---

## 3. Failure Matrix

| Failure | User message | Recovery |
|---------|--------------|----------|
| `email_not_verified` | Confirm your email before this device can be activated… | **Verify email** link → `/verify-email`, then Try again |
| `device_limit_reached` | Plan device limit is reached… | Redirect `/device-limit` → free slot |
| `approval_expired` | Approval request expired… | Try again (auto re-register + approve) |
| `activation_failed` | Activation could not finish… | Try again (safe retry, no logout) |
| `network_error` / `timeout` | Network / timeout messages | Auto-retry up to 8× |
| `invalid_device_fingerprint` | Device could not be identified… | Try again (new UUID generated) |
| `device_revoked` | (pending page) | Owner must re-approve in Devices |
| `device_pending` (staff) | Pending approval page | Wait for owner |

---

## 4. Android Validation Scenarios

| Scenario | Expected behavior |
|----------|-------------------|
| First device | Register → auto-approved active → POS |
| Additional device, slot free | Register pending → owner auto-approve → activate → POS |
| Full slot | Register or approve returns `limit_blocked` → `/device-limit` |
| Slow / intermittent network | Limit context retried 3×; pipeline retried 3×; page auto-retry 8× |
| Cold start / resume | Same pipeline; device ID from localStorage or fresh UUID |
| Fresh install / cleared storage | New fingerprint; pending row; owner auto-approve if slot free |
| Unverified email | Clear message + verify link (not infinite “Preparing…”) |

---

## 5. Diagnostics Guide

**Log prefix:** `[waka-device-activation]`

| Event | Fields | When |
|-------|--------|------|
| `login`, `register`, `approve`, `activate`, `refresh`, `completed` | `shopId`, optional detail | Stage start (all environments for info on stages) |
| `attempt` | `attempt`, `shopId`, `deviceId`, `stage`, `rpc`, `elapsedMs`, `approvalStatus`, `activationStatus`, `failureReason`, `failureDetail` | After each RPC |
| `{stage}_failed` | `kind`, detail | On failure |

**No credentials logged.** Device ID is fingerprint UUID only.

**Example (WebView console):**
```
[waka-device-activation] register { shopId: "…" }
[waka-device-activation] attempt { stage: "register", rpc: "shop_device_register_on_login", approvalStatus: "pending", … }
[waka-device-activation] approve_failed email_not_verified { error: "email_not_verified" }
```

---

## 6. Files changed

| File | Change |
|------|--------|
| `src/lib/deviceActivation.ts` | Pipeline hardening, structured outcomes |
| `src/lib/deviceActivationDiagnostics.ts` | Enterprise failure kinds + attempt logging |
| `src/lib/deviceId.ts` | Valid fingerprint fallback |
| `src/lib/devicePendingApproval.ts` | TTL 15 min (match SQL) |
| `src/pages/DeviceActivatingPage.tsx` | Precise errors, email verify action |
| `src/context/DeviceActivationContext.tsx` | Correct limit routing |
| `src/lib/i18n.ts` | New activation error strings |
| `supabase/migrations/139_device_activation_reliability.sql` | ensure_activation + TTL |
| `src/lib/deviceActivation.test.ts` | Updated + new cases |

---

## 7. Regression

Unchanged: device limits, approval model, staff RPCs, backup, offline, sync, subscriptions, security PIN, POS.

**No Primary Device return. No bypass logic.**

---

## 8. Deployment note

Apply migration **139** to remote Supabase before shipping client build that depends on updated `shop_device_ensure_activation` and 15-minute pending TTL.
