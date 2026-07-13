# Phase 25.1 — Enterprise Staff Identity Reliability

**Mode:** Enterprise implementation + manual certification (staff identity platform only)  
**Status:** Implementation complete — **manual certification matrix required before production sign-off**  
**Builds on:** [Phase 25.0 certification](./PHASE_25_0_ENTERPRISE_STAFF_IDENTITY_PLATFORM_CERTIFICATION.md)

---

## Acceptance Criterion

Phase 25.1 is **not** complete when sync “eventually works.” The question is:

> **Is a staff account a permanent shop identity?**

If yes, every owner device must observe the **same staff directory**, regardless of which device created the staff member.

Implementation (P0/P1 code changes) is done. **Enterprise sign-off requires every scenario in the [Manual Certification Matrix](#manual-certification-matrix) to pass on live devices.**

---

## Enterprise Staff Identity Guarantee

Once a staff member is successfully created in the cloud:

- It exists as part of the shop’s **permanent identity**.
- It is **not tied** to the device that created it.
- It is **immediately visible** to every owner device.
- It **survives**:
  - logout / login
  - app restart
  - Android reinstall
  - Windows reinstall
  - cloud recovery
  - device replacement
  - offline / online transitions

It can **only disappear** if:

- the owner deletes it
- the owner suspends it (hidden according to business rules)
- the shop itself is removed

**Never because of synchronization.**

---

## Enterprise Success Criteria

When Phase 25.1 is certified, staff must behave exactly like owner accounts:

| Property | Requirement |
|----------|-------------|
| Creation | Created once, stored in cloud as authoritative source |
| Local cache | Cached locally only for offline operation |
| Propagation | Automatically synchronized to every authorized owner device |
| Durability | Never lost because of cache divergence |
| Integrity | Never duplicated because of merge conflicts |
| Device independence | Never dependent on which device created the staff member |

**Target reliability:** Staff Identity **6.2 → 9.6–9.8 / 10** (Phase 25.0 baseline → post-25.1)

---

## Manual Certification Matrix

Phase 25.1 **must not** be considered production-ready until **all ten scenarios pass** on live hardware (Android + Windows + Web minimum).

| # | Scenario | Pass criteria | Implementation readiness | Live cert |
|---|----------|---------------|--------------------------|-----------|
| 1 | **Cross-device creation** | Device A creates Cashier John → A, B, Windows, Android, Web all show John within ~1 s | Realtime (`shops.staff_version`) + ACK pull wired | ☐ |
| 2 | **Fresh login** | Create staff → logout → login → John still exists | Cloud-authoritative + recovery pull on login | ☐ |
| 3 | **Different owner device** | Phone A creates Manager Sarah → Phone B owner login → Sarah already present, no sync button, no waiting | Forced hydration + version check (no localCount skip) | ☐ |
| 4 | **New installation** | Fresh Android install → owner login → full staff directory auto-downloads, no wizard, no missing staff | `pullAndMergeStaffAccountsForRecovery` + cache provisioning | ☐ |
| 5 | **Cloud recovery** | Clear app → recover → every staff member restored, no duplicates, no missing users | Recovery staff step + tombstone merge + snapshot dedupe | ☐ |
| 6 | **Offline reconnect** | Phone A creates online → Phone B offline → B reconnects → staff appears automatically | Event-driven pull on reconnect/visibility | ☐ |
| 7 | **Edit** | Rename John → John Smith on every device, no duplicate John | Cloud upsert + delta mirror | ☐ |
| 8 | **Delete** | Delete John → removed everywhere, never returns after recovery | Tombstone cloud → cache → preferences | ☐ |
| 9 | **PIN reset** | Reset PIN → every device uses new PIN, old PIN never works | Cloud push + delta; **see risk below** | ☐ |
| 10 | **Large staff list** | 50 / 100 / 200 staff — no disappearance, duplicates, or partial downloads | Versioned delta RPC + merge tests | ☐ |

### Scenario details

#### Scenario 1 — Cross-device creation

**Device A:** Create Cashier John.

**Expected:**

- Device A immediately shows John.
- Device B shows John within about 1 second.
- Windows shows John.
- Android shows John.
- Web shows John.

#### Scenario 2 — Fresh login

Create staff → logout → login again.

**Expected:** John still exists.

#### Scenario 3 — Different owner device

Phone A → create Manager Sarah → Phone B owner login.

**Expected:** Sarah already exists. No sync button. No waiting.

#### Scenario 4 — New installation

Install Android → owner logs in.

**Expected:** Entire staff directory downloads automatically. No staff creation wizard. No missing staff.

#### Scenario 5 — Cloud recovery

Clear app → recover.

**Expected:** Every staff member restored. No duplicates. No missing users.

#### Scenario 6 — Offline

Phone A: create while online. Phone B: already offline → reconnect.

**Expected:** Staff appears automatically.

#### Scenario 7 — Edit

Rename John → John Smith.

**Expected:** Every device updates. No duplicate John.

#### Scenario 8 — Delete

Delete John.

**Expected:** Removed everywhere. Never returns after recovery.

#### Scenario 9 — PIN reset

Reset PIN.

**Expected:** Every device uses the new PIN. Old PIN never works again.

#### Scenario 10 — Large staff list

Create 50, 100, and 200 staff.

**Expected:** No disappearance. No duplicates. No partial downloads.

---

## Certification procedure

1. Use a **Supabase shop** (not local auth mode) with at least two authorized owner devices.
2. Enable diagnostics: `localStorage.setItem("waka.staff.log", "1")`.
3. Run scenarios 1–10 in order; record timestamps from `[waka-staff]` logs.
4. For Scenario 1, measure Device B visibility latency (target **≤ 1 s** on healthy network).
5. For Scenario 10, use bulk create or scripted creates; verify counts match on all devices after 30 s.
6. Sign off only when all ☐ cells are checked.

**Out of scope for certification:** Local auth mode shops (`authMode === "local"`) — staff is device/snapshot scoped by design.

---

## Implementation Summary (code complete)

Phase 25.1 addressed Phase 25.0 P0/P1 findings. Technical changes are merged; they **enable** the guarantee above but do not replace live certification.

### Before vs. after (orchestration)

**Before (Phase 25.0 baseline):**

```
Create → cloud (sometimes) → cache OR preferences (divergent)
Delete → cloud tombstone → cache only → preferences keeps row
Device B → 45s throttle → maybe stale roster
Hydrate → if localCount > 0 → skip cloud validation
Realtime → shop_activity only (staff_version ignored)
```

**After (Phase 25.1):**

```
Create/Update/Delete → cloud ACK → staffCache → preferences mirror
Delete → tombstone → cache → preferences → UI → login cache
Device B → staff_ack / staff_realtime → immediate pull (no throttle)
Hydrate → always version-check cloud → merge → mirror
Realtime → shops.staff_version UPDATE → staff_realtime pull
```

### Source-of-truth model

| Layer | Role | Authority |
|-------|------|-----------|
| **Supabase `shop_pos_staff`** | Identity source | **Authoritative** |
| **`staffCache` (IndexedDB)** | Offline authentication | **Authoritative for login** |
| **`preferences.staffAccounts`** | Owner UI + lock screen | **UI mirror** — derived from cache/cloud |

### Key mechanisms

| Mechanism | Module |
|-----------|--------|
| Tombstone propagation | `staffSyncApply.ts` |
| Unified cache mirror | `staffCacheSync.ts` → `writeStaffCacheAndMirrorToPreferences` |
| Forced hydration (no localCount skip) | `staffRecovery.ts` → `hydrateStaffTeamFromCloud` |
| ACK synchronization | `staffSyncQueue.ts` → `afterStaffCloudAck` |
| Event throttle bypass | `staffRecovery.ts` — `staff_ack`, `staff_realtime`, reconnect, etc. |
| Staff realtime | `realtimeSyncPull.ts` — `shops.staff_version` |
| Queue coalescing | `syncQueuePriority.ts` — `pending_staff:{staffId}` |
| Snapshot dedupe | `usePosStore.ts` — `dedupeStaffAccountsOnLoad` |
| Recovery staff pull | `postAuthCloudHydrate.ts` → `pullAndFinalizeRecoveryStaff` |
| Diagnostics | `staffSyncDiagnostics.ts` — `[waka-staff]` |

### Files changed

| File | Change |
|------|--------|
| `src/lib/staffSyncApply.ts` | Tombstones, `computeImplicitStaffTombstones` |
| `src/lib/staffCacheSync.ts` | Unified mirror path |
| `src/lib/staffRecovery.ts` | Hydration fix, throttle bypass |
| `src/lib/staffSyncQueue.ts` | `afterStaffCloudAck`, stable queue ids |
| `src/lib/immediateSync.ts` | `scheduleImmediateStaffPull` |
| `src/lib/realtimeSyncPull.ts` | `shops` subscription for staff_version |
| `src/lib/syncQueuePriority.ts` | `pending_staff` coalesce key |
| `src/lib/staffSyncDiagnostics.ts` | Expanded metrics |
| `src/store/usePosStore.ts` | ACK on update/delete, snapshot dedupe |
| `src/offline/cloudSync.ts` | Pass `pullReason` to staff merge |

---

## Known risks vs. certification matrix

These items may cause **live certification failure** until resolved or explicitly waived:

| Risk | Affected scenarios | Severity |
|------|-------------------|----------|
| ~~**`resetStaffSecret` has no offline retry queue**~~ | 9 | **Resolved in Phase 25.1A** |
| **`customStaffRoles` not cloud-synced** — role assignments may diverge | 1, 3, 7 (role context) | P2 — identity OK, permissions may differ |
| **Device authorization gate** — unauthorized devices cannot push mutations | 1, 3 if device pending approval | Expected security behavior |
| **Fresh device staff login** requires owner sign-in once to provision encrypted cache | 4 (staff login before owner) | Expected — owner cert uses owner login |
| **No automated multi-device e2e tests** | All | Process gap — manual matrix required |

---

## Regression protection

Verified unchanged by implementation:

- Offline PIN verification (`staffOfflineAuth`, `staffSecret`)
- Encrypted staff cache (device-bound AES key)
- Device authorization gates
- Cloud-first create for Supabase shops
- Admin credential recovery
- Staff permissions model
- Owner authentication

---

## Verification (automated)

```bash
npm run build
npm test
```

Unit/integration coverage: `staffRecovery.test.ts`, `staffSyncApply.test.ts`, `staffCacheSync.test.ts`, `staffCredentialRecovery.test.ts`, `staffOfflineAuth.cache.test.ts`.

**Automated tests prove merge rules and orchestration — not cross-device latency or reinstall behaviour. The manual matrix is the enterprise gate.**

---

## Remaining technical debt

1. ~~**PIN reset retry queue**~~ — completed in [Phase 25.1A](./PHASE_25_1A_ENTERPRISE_STAFF_PIN_RESET_RELIABILITY.md)
2. **Custom roles cloud sync** — `customStaffRoles` remain local-only
3. **Cross-device latency UI metric** — optional hook on `StaffTeamList`
4. **Consolidate `cloudRowToStaff`** — duplicate in `shopStaffCloud.ts` and `staffCacheSync.ts`
5. **Multi-device e2e harness** — automate Scenarios 1, 6, 7, 8

---

## Related documents

- [Phase 25.0 — Staff Identity Platform Certification](./PHASE_25_0_ENTERPRISE_STAFF_IDENTITY_PLATFORM_CERTIFICATION.md)
- [Phase 21.4 — Staff Synchronization Reliability](./PHASE_21_4_ENTERPRISE_STAFF_SYNCHRONIZATION_RELIABILITY.md)
- [Phase 24.2A — Cloud Recovery Performance](./PHASE_24_2A_ENTERPRISE_CLOUD_RECOVERY_PERFORMANCE_AND_RELIABILITY.md) (Scenario 5 dependency)
