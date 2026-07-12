# Phase 21.9 — Enterprise Staff Credential Recovery

Production enterprise recovery for bulk staff credential invalidation. Complements Phase 20.4 (Shop Security PIN sync) and Phase 21.1 (Shop Security PIN recovery) without changing owner authentication, device activation, staff roles, or permission architecture.

## Objective

Allow Internal Admin to **Reset All Staff Credentials** for a shop so that every staff PIN and password is invalidated across all approved devices. Staff are guided to create new credentials on next login.

## Architecture

```
Internal Admin
      │
      ▼
admin_shop_reset_all_staff_credentials (RPC)
      │
      ├── Null pin_hash / password_hash on shop_pos_staff
      ├── Scrub staffAccounts in shop_cloud_snapshots
      ├── Set shop_recovery_signals.clear_staff_credentials_at
      └── Audit: admin_reset_all_staff_credentials
      │
      ▼
Devices fetch shop_fetch_recovery_signal
      │
      ▼
applyAdminStaffCredentialsClear (per device)
      │
      ├── Strip local staff PIN/password hashes
      ├── Clear staff auth, remember-me, unlock limiter
      ├── Clear encrypted offline staff cache
      └── Set credentialsInvalidatedAt on staff rows
```

Recovery scheduling is unified with Shop Security PIN recovery via `scheduleShopRecovery()` in `shopRecoveryOrchestration.ts`.

## Recovery scope

### Reset

- Staff PIN hashes
- Staff password hashes
- Cached staff credentials (preferences + offline cache)
- Remembered staff login state
- Staff unlock sessions / biometric unlock sessions for staff

### Preserved

- Owner account and session
- Shop Security PIN (unless separately cleared)
- Device approvals and activation
- Subscriptions, sales, inventory, shifts, shop preferences

## Cloud synchronization

1. Internal Admin invokes `adminShopResetAllStaffCredentials()` → RPC `admin_shop_reset_all_staff_credentials`.
2. Server sets `clear_staff_credentials_at` on `shop_recovery_signals`.
3. Each device calls `shop_fetch_recovery_signal` on app launch, resume, owner login, cloud reconnect, background sync, and staff login attempt.
4. `applyAdminStaffCredentialsClear` applies the signal once per timestamp (idempotent via `waka.recovery.staffClearApplied.v1::{shopId}`).

## Local cache invalidation

On recovery signal application:

| Cleared | Preserved |
|---------|-----------|
| `staffAccounts` PIN/password hashes | `backOfficePin` |
| Staff session / remember-me | Owner session |
| Offline staff cache | Sales, inventory, shifts |
| Staff unlock limiter state | Device approvals |

## Onboarding after recovery

Staff login flow:

1. Staff enters shop name + identifier + PIN attempt.
2. `staffAccountNeedsCredentialSetup()` detects missing/invalidated credentials.
3. `StaffCredentialRecoveryRequiredError` opens `StaffRecoveryCredentialSetup`.
4. Staff sets new PIN (optional password).
5. `completeStaffCredentialRecovery()` hashes secrets, pushes to cloud, clears `credentialsInvalidatedAt`.
6. Login continues with the new PIN.

Owner notification: `StaffCredentialRecoveryBanner` in App Shell when recovery notice is active.

## Internal Admin UX

Three clearly separated recovery actions in Account Recovery / Support:

| Action | RPC / method |
|--------|----------------|
| Clear Shop Security PIN | `admin_shop_reset_backoffice_pin` |
| Reset Staff Credentials | `admin_shop_reset_all_staff_credentials` |
| Reset Owner Password | Email reset or direct set |

## Audit trail

Device audit action: `admin_staff_credentials_clear_applied`

Server audit action: `admin_reset_all_staff_credentials`

Recorded fields:

- Shop ID
- Admin actor (server)
- Timestamp
- Recovery reason / trigger
- Affected staff count
- Completion status

Never logged: PINs, passwords, or hashes.

## Diagnostics

Console prefix: `[waka-staff-recovery]`

Steps:

1. `recovery_detected`
2. `cloud_invalidation`
3. `local_cache_cleared`
4. `credential_reset_required`
5. `staff_setup_complete` (after staff re-enrollment)

No secrets in diagnostic output.

## Regression checklist

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Reset all staff credentials | All active staff invalidated |
| 2 | Owner unaffected | Owner login and session unchanged |
| 3 | Shop Security PIN unaffected | `backOfficePin` preserved during staff reset |
| 4 | Offline device reconnects | Recovery applied from cloud signal |
| 5 | Staff login after recovery | PIN setup modal → login succeeds |
| 6 | Recovery audit trail | `admin_staff_credentials_clear_applied` logged |
| 7 | Multiple devices | All devices clear credentials on signal |

Automated coverage: `staffCredentialRecovery.test.ts`, extended `shopRecoverySignals.test.ts`.

## Verification matrix

| Component | File |
|-----------|------|
| SQL migration | `supabase/migrations/142_enterprise_staff_credential_recovery.sql` |
| Admin RPC client | `src/lib/wakaInternalAdmin.ts` → `adminShopResetAllStaffCredentials` |
| Signal apply | `src/lib/shopRecoverySignals.ts` → `applyAdminStaffCredentialsClear` |
| Orchestration | `src/lib/staffCredentialRecovery.ts`, `shopRecoveryOrchestration.ts` |
| Post-recovery setup | `src/lib/staffCredentialRecoveryOps.ts` |
| Staff login UX | `StaffRecoveryCredentialSetup.tsx`, `EnterpriseStaffLoginPanel.tsx` |
| Owner banner | `StaffCredentialRecoveryBanner.tsx`, `AppShell.tsx` |
| Internal Admin UI | `AccountRecoveryPanel.tsx`, `ShopConsoleSupportTab.tsx`, `EnterpriseShopConsolePage.tsx` |

## Related phases

- **Phase 20.4** — Shop Security PIN synchronization
- **Phase 21.1** — Shop Security PIN recovery signal pipeline
- **Phase 22.0** — Enterprise production regression certification (next)
