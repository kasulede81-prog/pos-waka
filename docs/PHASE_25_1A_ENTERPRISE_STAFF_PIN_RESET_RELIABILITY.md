# Phase 25.1A — Enterprise Staff PIN Reset Reliability

**Mode:** Enterprise implementation (Staff Identity Platform only)  
**Status:** Complete  
**Builds on:** [Phase 25.1](./PHASE_25_1_ENTERPRISE_STAFF_IDENTITY_RELIABILITY.md), [Phase 25.0 certification](./PHASE_25_0_ENTERPRISE_STAFF_IDENTITY_PLATFORM_CERTIFICATION.md)

---

## Objective

Close the final functional gap identified during Phase 25.0/25.1 certification: **PIN reset must behave exactly like create, update, and delete** — reliable, offline-safe, cloud-authoritative, retryable, and realtime-propagated.

This phase fixes **only** the PIN/password reset synchronization path. No Staff Platform redesign.

---

## Before vs. After

### Before

```
Reset PIN
  → Local hash update
  → pushStaffToCloud (immediate only)
  → Failure
  → Lost propagation (Device B keeps old PIN)
```

### After

```
Reset PIN
  → Local hash update
  → syncStaffSecretResetInCloud
       ├─ Online + success → Cloud ACK → staff_version → realtime → Device B
       └─ Offline / failure → pending_staff queue → retry scheduler → Cloud ACK
```

---

## Queue Integration

Reuses existing infrastructure — **no new queue type**:

| Component | Usage |
|-----------|--------|
| `pending_staff` | `action: "reset_secret"` |
| `enqueueSync` | Stable op id `staff:reset_secret:{staffId}` (overwrites on retry) |
| `syncQueuePriority` | Coalesce key `pending_staff:{staffId}` |
| `immediateSync` | Coalesced push on enqueue |
| `processCloudSyncOperation` | Routes to `processPendingStaffSync` |
| `autoSync` backoff | Standard retry policy |

---

## Retry Architecture

### Idempotent processing

`resolveStaffForPendingPush()` before every push:

1. Reads **live store row** for the staff id.
2. If staff **deleted** → skip safely, consume queue op (no cloud recreate).
3. If live row exists → `pickNewerStaffAccount(queued, live)` — **newest `updatedAt` wins**.
4. Multiple retries with same op id → IndexedDB `put` overwrites → single effective mutation.

### Offline timeline

```
Device A (offline)
  → Owner resets PIN
  → Local hash updated (PIN works on Device A immediately)
  → pending_staff enqueued (pin_reset_queued)
  → Reconnect
  → sync engine flush
  → pushStaffToCloud (newest row)
  → Cloud ACK (pin_reset_ack)
  → staff_version bump
  → Realtime on Device B
  → staff_realtime pull
  → Cache + preferences mirror
  → Device B accepts new PIN
```

No manual retry required.

---

## ACK Propagation

Successful cloud acknowledgement uses the **same path** as create/update/delete:

```
PIN reset success
  → afterStaffCloudAck("reset_secret")
  → refreshStaffCacheAfterOwnerMutation()
  → scheduleImmediateStaffPull("staff_ack")
  → scheduleIncrementalCloudPull(staff_ack)
  → (other devices) shops.staff_version realtime
  → staff_realtime pull
  → writeStaffCacheAndMirrorToPreferences
```

---

## Diagnostics (`[waka-staff]`)

Enable: `localStorage.setItem("waka.staff.log", "1")`

| Event | When |
|-------|------|
| `pin_reset_started` | Owner initiates reset |
| `pin_reset_queued` | Offline or push failure — enqueued |
| `pin_reset_retry` | Queue processor push failed — will retry |
| `pin_reset_ack` | Cloud confirmed reset |
| `propagation_latency` | End-to-end propagation metric hook |

**Never logged:** PIN, PIN hash, passwords, credentials.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/staffSyncQueue.ts` | `syncStaffSecretResetInCloud`, `resolveStaffForPendingPush`, `reset_secret` processing |
| `src/lib/staffSyncDiagnostics.ts` | PIN reset diagnostic events |
| `src/store/usePosStore.ts` | `resetStaffSecret` → `syncStaffSecretResetInCloud` |
| `src/lib/staffSyncQueue.test.ts` | Regression tests (6 scenarios + failure paths) |

---

## Test Scenarios

| # | Scenario | Test |
|---|----------|------|
| 1 | Online PIN reset → immediate propagation | `scenario 1: online PIN reset pushes immediately and ACKs` |
| 2 | Offline → queued → reconnect | `scenario 2: offline PIN reset is queued for reconnect` |
| 3 | Multiple retries → single cloud mutation | `scenario 3: multiple queue retries coalesce...` |
| 4 | Cloud ACK → realtime path | `scenario 4: cloud ACK triggers cache refresh...` |
| 5 | Concurrent update → newest wins | `scenario 5: concurrent update — live store newer...` |
| 6 | Deleted staff → queued reset ignored | `scenario 6: deleted staff — queued PIN reset ignored safely` |

Additional: push failure queues online; processPendingStaffSync returns false for retry.

---

## Regression Protection

Verified unchanged:

- Offline staff login (`staffOfflineAuth`)
- Staff permissions model
- Encrypted staff cache
- Device authorization gates
- Cloud recovery staff pull
- Shop Security PIN
- Owner authentication
- Local auth mode (reset remains local-only)

---

## Verification

```bash
npm run build
npm test
```

---

## Success Criteria

- [x] PIN reset as reliable as create/update/delete
- [x] Offline resets auto-sync after reconnect
- [x] No reset lost to temporary network failure
- [x] Cloud ACK triggers same realtime propagation
- [x] Idempotent retries — newest version wins, no deleted staff resurrection
- [x] `[waka-staff]` diagnostics for reset lifecycle
- [x] Build and all tests pass

**Staff Identity Platform is ready for the full 10-scenario production certification matrix** (Scenario 9 unblocked).

---

## Remaining Staff Platform Technical Debt

1. **Custom roles cloud sync** — `customStaffRoles` local-only
2. **Cross-device latency UI** — optional metric on `StaffTeamList`
3. **Multi-device e2e harness** — automate certification matrix
4. **Consolidate `cloudRowToStaff`** — duplicate converters

---

## Related Documents

- [Phase 25.1 — Staff Identity Reliability](./PHASE_25_1_ENTERPRISE_STAFF_IDENTITY_RELIABILITY.md)
- [Phase 25.0 — Staff Identity Platform Certification](./PHASE_25_0_ENTERPRISE_STAFF_IDENTITY_PLATFORM_CERTIFICATION.md)
