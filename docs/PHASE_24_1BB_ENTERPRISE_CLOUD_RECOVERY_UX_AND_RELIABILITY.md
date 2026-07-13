# Phase 24.1BB — Enterprise Cloud Recovery UX & Reliability

**Mode:** Enterprise implementation (Cloud Recovery only)  
**Builds on:** [Phase 24.1BA forensic certification](./PHASE_24_1BA_ENTERPRISE_CLOUD_RECOVERY_FORENSIC_CERTIFICATION.md)  
**Status:** Complete

---

## Objective

Transform Cloud Recovery from a blocking startup gate into an **enterprise background recovery experience** while preserving integrity-first guarantees. Recovery must not prevent business operations when the critical dataset is already available.

**Target:** Cloud Recovery readiness **6.8 → 9.0–9.3 / 10**

---

## Before vs After

### Before (24.1BA)

```
Download all modules
  → reportRecoveryStep("validation")  ← progress hits 100%
  → Trust certification (blocking)
  → Full gate must pass
  → Overlay dismisses OR "Recovery could not finish" at 100%
  → failed lock blocks sync + post-bootstrap
```

### After (24.1BB)

```
Download + persist
  → progress max 90%
  → validateCoreOperationalGate (products + core integrity)
  → unlockCoreRecoverySession → dismiss overlay → POS usable
  → progress 95% (background certification)
  → runBackgroundRecoveryCertification()
  → progress 100% only on completeCloudRecoverySession()
  → Non-blocking banner for cert warnings
```

---

## Honest Progress Model

| Phase | Progress | Trigger |
|-------|----------|---------|
| Download | 0–90% | `CLOUD_RECOVERY_DOWNLOAD_STEP_ORDER` steps |
| Validating | 95% | `progressPhase === "validating"` |
| Finalizing | 98% | Snapshot upload / finalize |
| Complete | **100%** | `completeCloudRecoverySession()` only |

Implementation: `src/lib/recoveryProgress.ts` → `computeRecoveryProgressPct()`

**Fix:** Removed pre-gate `reportRecoveryStep("validation")` that caused 100% before failure.

---

## Core vs Optional Module Classification

| Critical (unlock) | Optional (background) |
|-------------------|------------------------|
| Products | Sales history tail |
| Customers | Shifts / cash records |
| Preferences / shop | Reports / analytics |
| Inventory catalog | Diagnostics / audit |
| Staff | Enterprise health metrics |
| Permissions | AI cache |

Source: `src/lib/recoveryModuleClassification.ts`

---

## Unlock Strategy

**Core operational gate** (`validateCoreOperationalGate`):

- Cloud expected → local must have products OR core data
- No critical validator failures
- Does **not** require full trust certification parity

On pass:

1. `markBootstrapSyncComplete()` — operational bootstrap
2. `unlockCoreRecoverySession()` — status `core_unlocked`
3. `isCloudRecoveryLockActive()` → **false** (sync/post-bootstrap resume)
4. Overlay dismissed — AppShell interactive

---

## Background Certification Architecture

```
runCloudRecoveryGated()
  ├─ runHydrateAccountFromCloudInner()  [blocking download]
  ├─ validateCoreOperationalGate()
  ├─ unlockCoreRecoverySession()
  └─ void runBackgroundRecoveryCertification()  [non-blocking]
       ├─ fetchCloudEntityCounts()
       ├─ buildCloudTrustCertificationReport()
       ├─ validateRecoveryCompletionGate()
       ├─ On non-core failures → recordCertificationWarnings() + banner
       └─ On success → completeCloudRecoverySession()
```

Source: `src/lib/backgroundRecoveryCertification.ts`

---

## Recovery Lock Refinement

| Status | Blocks push/sync? | Blocks UI? |
|--------|-------------------|------------|
| `active` | YES | Full overlay |
| `core_unlocked` | NO | Banner only |
| `certifying` | NO | Banner only |
| `failed` | NO | Overlay if PosDataProvider sets it |
| `complete` | NO | None |

`isCloudRecoveryLockActive()` → **`active` only** (was `active || failed`).

---

## Module Checkpoints & Resume

LocalStorage key: `waka.recovery.modules.v1:{accountKey}`

After each recovery step: `markRecoveryModuleComplete(module, counts)`

On retry:

- Skip snapshot if products checkpoint matches store
- Skip full download if `allCriticalModulesCheckpointed()`

Source: `src/lib/recoveryModuleCheckpoints.ts`

---

## Recovery Banner (Android / Web)

`RecoveryBackgroundBanner` — non-blocking `EnterpriseFeedbackBanner` at top:

- **Certifying:** "Verifying cloud data… Your business is ready"
- **Warnings:** Classification-specific message + retry
- **Background sync:** "Recovering remaining data in the background"

AppShell and navigation remain usable.

---

## Failure Classification

Precise UX via `classifyRecoveryFailure()`:

| Class | Blocking? |
|-------|-----------|
| `core_data_missing` | YES |
| `network_interruption` | YES (probe) |
| `validation_failed` | YES |
| `certification_pending` | NO |
| `certification_warning` | NO |
| `reports_unavailable` | NO |

---

## Diagnostics

Prefix: **`[waka-recovery]`** (dev or `localStorage.waka.recovery.log = "1"`)

Events: `download_start`, `persist`, `core_unlock`, `certification_start`, `certification_end`, `complete`, `resume`, `retry`

Performance marks: `coreRecoveredMs`, `posUnlockedMs`, `certificationFinishedMs`, `recoveryCompletedMs`

Source: `src/lib/recoveryDiagnostics.ts`

---

## Files Changed / Added

| File | Role |
|------|------|
| `recoveryProgress.ts` | Honest 90/95/100 progress |
| `recoveryModuleClassification.ts` | Critical vs optional |
| `recoveryModuleCheckpoints.ts` | Resume on retry |
| `recoveryDiagnostics.ts` | `[waka-recovery]` logging |
| `recoveryFailureClassification.ts` | Precise failure UX |
| `backgroundRecoveryCertification.ts` | Post-unlock certification |
| `cloudRecoverySession.ts` | Lock refinement, new statuses |
| `cloudRecoveryGate.ts` | `validateCoreOperationalGate` |
| `postAuthCloudHydrate.ts` | Split download / certify |
| `CloudRecoveryScreen.tsx` | Honest progress + failure class |
| `RecoveryBackgroundBanner.tsx` | Non-blocking banner |
| `PosDataProvider.tsx` | Dismiss overlay on core unlock |

---

## Remaining Technical Debt

1. **Per-entity pull resume** — checkpoints skip full re-download but not individual RPC pagination cursors
2. **Sales tail during unlock** — large sales history may still download before core gate if monolithic pull
3. **Certification warning persistence** — banner dismiss UX not yet stateful across sessions
4. **Native WorkManager** — Android background retry still UI-timer based

---

## Verification

```bash
npm run build   ✅
npm test        ✅
```

No changes to: authentication, device management, sync algorithms, database schema, business logic, security verification.

---

## Success Criteria Checklist

- [x] Progress never shows 100% before completion
- [x] App unlocks when core operational dataset is ready
- [x] Certification runs in background after unlock
- [x] Failed certification does not trap healthy devices (non-core → banner)
- [x] Recovery lock only during active download
- [x] Module checkpoints enable partial resume
- [x] Non-blocking banner on Android/Web
- [x] Build and tests pass
