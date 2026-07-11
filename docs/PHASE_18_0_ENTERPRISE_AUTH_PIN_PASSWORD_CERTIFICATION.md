# Phase 18.0 — Enterprise Authentication, PIN & Password Certification

**Mode:** Read-only enterprise audit (no code changes)  
**Date:** 2026-07-11  
**Baseline:** Phase 17.9 theme certification complete; auth not previously certified  
**Verdict:** **Not certified** — strong security foundations, fragmented PIN/password UX; consolidation required before implementation

---

## Executive Summary

Waka POS treats authentication seriously at the **security layer** (Argon2id hashing, progressive lockout, device authority, audit logging, native biometrics) but presents **multiple incompatible PIN and password experiences** across POS, back office, hospitality, pharmacy, and settings.

Users today must learn **different digit lengths (4 vs 6 vs 8)**, **different submit patterns (Lock icon vs Submit vs action button vs browser prompt)**, and **different error/lockout behaviors** depending on surface. This fails the Phase 18.0 banking-grade consistency bar.

**Highest-impact gaps:**

1. **No unified 4-digit auto-submit PIN UX** — every surface requires an explicit confirm action.
2. **Two PIN credential systems** — per-staff secrets vs shop `backOfficePin`, verified through overlapping but separate code paths.
3. **Three PIN UI primitives** — `EnterprisePinKeypad`, `PinInput`, and ad-hoc `<input type="password">` fields.
4. **Password UX inconsistent** — visibility toggle only on login; min-length 8 vs local-mode 4.
5. **Dead duplicate code** — `BiometricAuthModal` orphaned; `verifyOwnerPin` deprecated but still used in production paths.
6. **Internal Admin has no separate auth** — correct for security model, but support password tools use hardcoded English validation copy.

**Recommendation:** Phase 18.1 should implement a single **`EnterprisePinPad`** + **`EnterprisePasswordField`** primitive pair and migrate all surfaces before further feature work.

---

# 1. Enterprise Authentication Architecture Report

## 1.1 Layered dependency map

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ROUTE & FEATURE GATES                            │
│  ProtectedRoute │ RoleProtectedRoute │ OwnerProtectedRoute              │
│  InternalAdminOutlet (waka_internal_me) │ SensitiveActionGate            │
│  SettingsChangeGate │ BackOfficeRouteGuard │ DeviceActivationGateOutlet  │
└─────────────────────────────────────────────────────────────────────────┘
                                    ▲
┌─────────────────────────────────────────────────────────────────────────┐
│                    ELEVATED SECURITY (short-lived)                       │
│  BackOfficeSessionContext ──► securitySession.ts (5 min TTL)            │
│  SensitiveActionAuthContext ──► EnterpriseSecurityDialog               │
│  EnterpriseSecurityService (verifyShopSecurityPin, verifyStaffPin, …)   │
└─────────────────────────────────────────────────────────────────────────┘
                                    ▲
┌─────────────────────────────────────────────────────────────────────────┐
│                    RUNTIME ACTOR & PERMISSIONS                           │
│  SessionActorContext ◄── resolveSessionActor (staffSession | owner)     │
│  permissions.ts │ actorAuthorization.ts │ storeAuthorization.ts         │
└─────────────────────────────────────────────────────────────────────────┘
                                    ▲
┌─────────────────────────────────────────────────────────────────────────┐
│                    COMMERCIAL & DEVICE GATES                             │
│  ActivationContext │ DeviceActivationContext │ DeviceAuthorityContext    │
└─────────────────────────────────────────────────────────────────────────┘
                                    ▲
┌─────────────────────────────────────────────────────────────────────────┐
│                    ACCOUNT NAMESPACE                                     │
│  accountScope (sb:<uid> | local:<email>) │ usePosStore per account      │
└─────────────────────────────────────────────────────────────────────────┘
                                    ▲
┌──────────────────────┬──────────────────────┬───────────────────────────┐
│   OWNER IDENTITY     │   STAFF IDENTITY     │   INTERNAL ADMIN          │
│   useAuth.ts         │   staffOfflineAuth   │   wakaInternalAdmin.ts    │
│   Supabase PKCE      │   offline PIN cache  │   RPC waka_internal_me    │
│   local dev mode     │   signInStaff        │   (same Supabase session) │
└──────────────────────┴──────────────────────┴───────────────────────────┘
```

## 1.2 Identity paths

| Path | Provider | Session store | Clears other identities |
|------|----------|---------------|-------------------------|
| **Owner** | Supabase Auth (`useAuth`) | Supabase session + `accountScope` | Staff cleared on owner login |
| **Staff** | Offline cache + PIN (`authenticateStaffLogin`) | `staffOfflineAuth` persistence | Supabase signed out on staff login |
| **Local dev** | `localStorage` `waka-pos-local-session` | Email string | — |
| **Internal admin** | Supabase + `internal_admins` row | Same as owner | Not a separate login |

## 1.3 Core files (architecture SSOT)

| Layer | Primary files |
|-------|---------------|
| Owner auth | `src/hooks/useAuth.ts`, `src/lib/supabase.ts`, `src/lib/authConfig.ts` |
| Staff auth | `src/lib/auth/staffAuthentication.ts`, `src/lib/staffOfflineAuth.ts`, `src/lib/auth/staffSession.ts` |
| Lock/unlock | `src/lib/auth/staffLockScreen.ts`, `src/lib/lockPos.ts`, `src/hooks/useStaffAutoLock.ts` |
| Staff secrets | `src/lib/staffSecret.ts` (Argon2id/bcrypt/legacy) |
| Shop security PIN | `src/lib/enterpriseSecurity/shopPinSecret.ts` |
| Unified verify | `src/lib/enterpriseSecurity/EnterpriseSecurityService.ts` |
| Security session | `src/lib/enterpriseSecurity/securitySession.ts` (5 min) |
| Sensitive actions | `src/lib/sensitiveActionAuth.ts`, `src/context/SensitiveActionAuthContext.tsx` |
| Back office | `src/lib/backOfficeUnlock.ts`, `src/context/BackOfficeSessionContext.tsx` |
| Device | `src/lib/deviceAuthority.ts`, `src/lib/deviceActivation.ts`, `src/context/DeviceAuthorityContext.tsx` |
| Biometric | `src/lib/biometricAuth.ts` (`@aparajita/capacitor-biometric-auth`) |
| Internal admin | `src/lib/wakaInternalAdmin.ts`, `src/components/routing/InternalAdminOutlet.tsx` |

## 1.4 App provider stack (auth-relevant)

From `App.tsx` → `ProtectedRoute` → `ActivationProvider` → `DeviceActivationProvider` → `DeviceAuthorityBridge` → `PosDataProvider` → `AppShell`:

- `BackOfficeSessionProvider`
- `SensitiveActionAuthProvider`
- `SessionActorProvider` (inside AppShell)

**Notable:** No monolithic `AuthProvider`; `useAuth()` is called at app root.

## 1.5 Architecture strengths

- Fail-closed role resolution via `shop_members` (not metadata alone)
- Account namespace isolation on sign-in/sign-out
- Modern hashing (Argon2id) with legacy migration path
- Progressive unlock lockout (30s → 60s → 5min)
- Audit trails (`staffSessionAudit`, `staffSecurityAudit`, `enterpriseSecurity/audit`)
- Native biometric with explicit “never store biometrics” policy
- Back-office unlock satisfies sensitive-action prompts (no double PIN when session active)

## 1.6 Architecture gaps

- **Dual PIN stores:** `staffAccounts[].pinHash` vs `preferences.backOfficePin`
- **Dual session elevation:** legacy sensitive session + enterprise `SecuritySession`
- **Deprecated API still in production:** `verifyOwnerPin` in pharmacy/hospitality
- **No shared auth UI package:** primitives scattered across auth/security/hospitality/pharmacy
- **Internal admin password ops** bypass i18n and owner password validation patterns

---

# 2. PIN Certification Report

## 2.1 Complete PIN inventory

| # | Surface | Component / location | Route / trigger | Purpose | Length | Submit | Validation |
|---|---------|---------------------|-----------------|--------|--------|--------|------------|
| 1 | Staff login | `EnterpriseStaffLoginPanel` | `/login` staff tab | Offline staff sign-in | 4 (keypad default) | Lock icon + form Submit | `staffOfflineAuth` → `staffSecretMatchesAsync` |
| 2 | POS lock screen | `EnterpriseStaffLockScreen` | AppShell overlay when `posLocked` | Unlock POS / switch user | 4 keypad; accepts staff 4 or shop 4–6 | Lock icon | `verifyLockScreenPin` + lockout |
| 3 | Back office unlock | `BackOfficeUnlockModal` | `/office/*` via `BackOfficeRouteGuard` | Unlock reports/settings shell | 4–6 (`maxLength=6`) | Keypad Lock + Submit; desktop PinInput | `resolveBackOfficeUnlockAsync` |
| 4 | Back office PIN setup | `BackOfficePinForm` | `/settings/pin` | Set/change/remove shop PIN | 4–6 | Save / Remove buttons | `hashShopSecurityPin` |
| 5 | Sensitive action step-up | `EnterpriseSecurityDialog` | App-wide via `SensitiveActionAuthContext` | Refunds, settings, reports, staff mgmt | 4–6 | Form Submit (`enterpriseSecuritySubmit`) | `verifySecurityCredential` |
| 6 | Manager discount | `ManagerPinModal` | `TableOrderPage` | Approve bill discount | 4–6 | Footer confirm | `verifyManagerApprovalPinSync` |
| 7 | Reopen/void bill | `HospitalityManagerToolsSheet` | `FloorPlanPage` | Manager approval | **Exactly 4** | Reopen/Void buttons | `verifyOwnerPin` (deprecated) |
| 8 | Controlled Rx approval | `PharmacyControlledApprovalModal` | Dispense workspace | Manager approval | Up to **8** | Approve button | `verifyOwnerPin` |
| 9 | Controlled dispense | `PharmacyControlledDispenseGate` | Pharmacy checkout | Controlled medicine gate | Up to **8** | Confirm dispense | `verifyOwnerPin` |
| 10 | Float override | `FloatVerifyOverrideModal` | `ShiftOpeningScreen` | Opening float variance | Up to 6 | Save | `verifyManagerApprovalPinSync` |
| 11 | Day open correction | `DayOpenPage` | Day open route | Owner correction override | Up to 6 | Save correction | day-open mutations |
| 12 | Day close | `CloseDayPage` | Day close route | Variance / emergency / reopen | Up to 6 each | Multiple confirms | `dayCloseApprovals.ts` |
| 13 | Staff create | `StaffCreateWizard` | Staff settings wizard | Assign staff PIN | **Exactly 4** | Wizard Next | `hashStaffSecretAsync` |
| 14 | Staff PIN reset | `StaffAccessPage` | `/settings/staff` | Owner resets staff PIN | prompt 4–6; stored as 4 | Browser `window.prompt` OK | `resetStaffSecret` |
| 15 | Device management | `useProtectedAction` | DeviceManagementPage | Step-up before destructive ops | (dialog) | (dialog) | `EnterpriseSecurityDialog` |

**Not PIN auth:** `NumericKeypad` (hospitality quantity/amount entry).

**Orphaned:** `BiometricAuthModal` — duplicate of `EnterpriseSecurityDialog`, **zero imports**.

**Internal Admin:** No PIN gate; uses Supabase session + `waka_internal_me`.

## 2.2 PIN length matrix

| Credential | Configured length | UI enforcement | Storage |
|------------|-------------------|----------------|---------|
| Staff daily PIN | **4 digits** (creation enforced) | Keypad default 4 | `staffAccounts[].pinHash` Argon2id |
| Shop / back-office PIN | **4–6 digits** | Forms allow 4–6 | `preferences.backOfficePin` Argon2id |
| Manager approval (inline) | **4–8** depending on surface | Inconsistent | Same verify paths |
| `normalizePin()` | Truncates to **6 max** | Server-side normalize | — |

**Target standard (Phase 18.0):** 4 digits everywhere — **not met**.

## 2.3 Behavior matrix

| Behavior | Staff login | Lock screen | Back office | Security dialog | Hospitality | Pharmacy |
|----------|-------------|-------------|-------------|-----------------|-------------|----------|
| Auto-focus | Partial | Yes | Yes | Yes (`autoFocus`) | Varies | Varies |
| Auto-submit on 4th digit | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Enter / Lock button | Lock + Submit | Lock only | Lock + Submit | Submit | Action btn | Approve |
| Shake on wrong PIN | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Auto-clear on wrong | Partial | Partial | Partial | Yes (dialog clears) | Manual | Manual |
| Haptic feedback | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lockout | Staff login lockout | `staffLoginLimiter` | ❌ (no limiter in modal) | ❌ | ❌ | ❌ |
| Biometric fallback | ❌ | ✅ native | ✅ native | ✅ native | ❌ | ❌ |

## 2.4 Storage & hashing

| Secret | Hash algorithm | Location | Offline |
|--------|----------------|----------|---------|
| Staff PIN | Argon2id → bcrypt → legacy FNV/PBKDF2 | IndexedDB via `usePosStore` staffAccounts | ✅ |
| Shop security PIN | Argon2id (+ legacy plaintext 4–6 verify) | `preferences.backOfficePin` | ✅ |
| Owner Supabase password | Supabase Auth (server) | Supabase | ❌ (online) |

## 2.5 PIN consistency score: **4.2 / 10**

---

# 3. Password Certification Report

## 3.1 Password workflows

| Workflow | Page / component | Route | Min length | Visibility toggle | Strength UI | i18n errors |
|----------|------------------|-------|------------|-------------------|-------------|-------------|
| Login | `LoginPage` | `/login` | Supabase default | ✅ Eye/EyeOff | ❌ | ✅ |
| Register | `RegisterPage` | `/register` | 8 (client) | ❌ | ✅ meter | ✅ |
| Forgot password | `ForgotPasswordPage` | `/forgot-password` | — | ❌ | ❌ | ✅ |
| Reset password | `ResetPasswordPage` | `/reset-password` | 8 | ❌ | ❌ | ✅ |
| Change password | `SettingsPasswordPage` | `/settings/password` | 8 + match | ❌ | ❌ | ✅ |
| Google OAuth | `GoogleSignInButton` | login/register | — | — | — | ✅ |
| Account deletion re-auth | `AccountDeletionPage` | `/account/delete` | — | ❌ | ❌ | ✅ |
| Local dev login | `useAuth.signIn` | local mode | **4** | — | ❌ | English hardcoded |
| Internal admin set password | `SupportPasswordResetPanel` | internal admin | 8 | ❌ | ❌ | **English hardcoded** |
| Internal admin recovery | `AccountRecoveryPanel` | internal admin | 8 | ❌ | ❌ | **English hardcoded** |
| Staff optional password | `StaffCreateWizard` | staff wizard | varies | ❌ | ❌ | ✅ |

## 3.2 Password inconsistencies

1. **Min length split:** Owner flows = 8; local-mode = 4; Supabase signup not pre-validated in `useAuth`.
2. **Visibility toggle:** Only `LoginPage` — register/reset/settings/admin panels lack it.
3. **Strength meter:** Only registration — reset/settings have no feedback.
4. **Forgot password UX gap:** UI is email-only; `requestPasswordReset` supports phone lookup via RPC but form does not.
5. **Copy inconsistency:** Owner flows use `i18n`; internal admin panels use hardcoded English for validation.
6. **Settings password gated; biometric toggle not:** `SettingsPasswordPage` behind `SettingsChangeGate`; `SettingsBiometricPage` is not.

## 3.3 Password consistency score: **5.4 / 10**

---

# 4. Duplicate Authentication Report

## 4.1 PIN entry implementations

| Implementation | File | Classification | Used by |
|----------------|------|----------------|---------|
| **EnterprisePinKeypad** | `src/components/auth/EnterprisePinKeypad.tsx` | 🟡 Partial — shared but not universal | Staff login, lock screen, back-office mobile |
| **PinInput** | `src/components/ui/PinInput.tsx` | 🟡 Partial — text field not keypad | Security dialog, back-office desktop, settings, staff wizard |
| **NumericKeypad** | `src/components/hospitality/NumericKeypad.tsx` | ⚪ Not auth | Quantity entry |
| **Ad-hoc password inputs** | ManagerPinModal, CloseDayPage, DayOpenPage, pharmacy, float modal | 🔴 Duplicate | Domain-specific modals |

**Consolidation target:** One `EnterprisePinPad` (4-digit, auto-submit, dot indicators, shake, haptics) replacing all three auth patterns.

## 4.2 Security dialog implementations

| Component | Status | Notes |
|-----------|--------|-------|
| `EnterpriseSecurityDialog` | ✅ Active SSOT for sensitive actions | PinInput + Submit + biometric |
| `BiometricAuthModal` | ⚪ Dead | Never imported; delete candidate |
| `BackOfficeUnlockModal` | 🟡 Partial | Parallel unlock UX; different layout |
| `ManagerPinModal` | 🔴 Duplicate | Custom sheet + inline PIN |
| Pharmacy controlled modals | 🔴 Duplicate | Inline verify + custom errors |

## 4.3 Lock screen implementations

| Component | Scope |
|-----------|-------|
| `EnterpriseStaffLockScreen` | Full-screen POS lock |
| `BackOfficeUnlockModal` | Modal for office routes |
| `BackOfficeUnlockBanner` | Banner when locked out |

## 4.4 Verification service duplication

| API | Status | Consumers |
|-----|--------|-----------|
| `verifySecurityCredential` | ✅ Enterprise SSOT | SensitiveActionAuthContext |
| `verifyManagerApprovalPinSync` | ✅ Preferred sync path | Store mutations, float verify |
| `verifyOwnerPin` | 🔴 Deprecated | Pharmacy, hospitality billing |
| `verifyLockScreenPin` | ✅ Lock-specific | AppShell |
| `resolveBackOfficeUnlockAsync` | ✅ Back-office | BackOfficeSessionContext |

## 4.5 Duplicate score: **3.8 / 10** (lower = more duplication)

---

# 5. Security Policy Report

## 5.1 Current policies

| Policy | Staff login | Lock screen unlock | Sensitive action | Back office unlock | Manager inline |
|--------|-------------|-------------------|------------------|-------------------|----------------|
| Max attempts before lockout | 5 (`STAFF_LOCKOUT_MAX_ATTEMPTS`) | 5 (`UNLOCK_MAX_ATTEMPTS`) | ❌ none | ❌ none | ❌ none |
| Lockout duration | 15 min account lock | 30s → 60s → 5min progressive | — | — | — |
| Session timeout | 480 min default (configurable 15–1440) | — | 5 min security session | 5 min (shared session) | — |
| Auto-lock idle | 0–60 min (`staffAutoLockMinutes`) | — | — | — | — |
| Biometric fallback | ❌ | ✅ (native, current user) | ✅ (3 fails → PIN) | ✅ (owner/manager only) | ❌ |
| Offline auth | ✅ cached staff | ✅ | ✅ shop/staff PIN local | ✅ | ✅ |
| Audit logging | ✅ `staffSecurityAudit` | ✅ `staffSessionAudit` | ✅ enterprise audit | ✅ backOfficeUnlockAudit | Partial |

## 5.2 PIN length policy

| Rule | Documented | Enforced consistently |
|------|------------|----------------------|
| Staff PIN = 4 digits | Yes (wizard, store) | 🟡 Hospitality requires exactly 4; shop PIN allows 6 |
| Shop PIN = 4–6 | Yes | ✅ |
| Manager approval accepts either | Yes (EnterpriseSecurityService) | 🟡 Pharmacy allows 8-digit entry |

## 5.3 Password policy

| Rule | Enforced |
|------|----------|
| Minimum 8 characters (owner) | Client on register/reset/settings; not in useAuth signIn |
| Complexity meter | Register only |
| Supabase server rules | Default Supabase Auth policy |

## 5.4 Biometric policy

- Feature flag: `preferences.biometricAuthEnabled`
- Prerequisite: shop back-office PIN must be configured (`canEnableBiometricAuth`)
- Native only: `Capacitor.isNativePlatform()` — web/desktop users never see biometric buttons
- Waka does not store biometric templates (documented in i18n)
- OS fallback: `allowDeviceCredential: true`, iOS `"Use PIN"` fallback string
- **No Windows Hello-specific handling** — generic Capacitor biometry only

## 5.5 Security policy consistency score: **6.1 / 10**

---

# 6. Authentication UX Report

## 6.1 Ease of use

| Surface | Taps to unlock (typical) | Cognitive load |
|---------|--------------------------|----------------|
| Staff login | 4 digits + Lock + Submit = **6+ taps** | Medium — dual confirm |
| Lock screen | 4 digits + Lock = **5 taps** | Medium |
| Back office | 4–6 digits + Submit = **5–7 taps** | High — length ambiguity |
| Security dialog | Biometric OR PIN + Submit | Medium–high |
| Hospitality manager | 4 digits + action button | Medium |
| Staff reset | Browser prompt | **Poor** — breaks app UX |

## 6.2 Premium feel

- **Strengths:** EnterprisePinKeypad visual polish (dot indicators, rounded keys, dark mode keys); lock screen full-bleed gradient; biometric integration on native.
- **Weaknesses:** No shake animation; no PIN-specific haptics; error states use inconsistent color tokens (some still emerald/rose hardcoded in security dialog); `window.prompt` on staff reset.

## 6.3 Accessibility

| Criterion | Status |
|-----------|--------|
| Focus management | 🟡 `autoFocus` on PinInput; keypad buttons lack explicit aria pressed states |
| Screen reader | 🟡 Dot indicators marked `aria-hidden`; Lock button has `aria-label` |
| Touch targets | ✅ 44–48px min on keypad |
| Keyboard (desktop) | 🟡 PinInput works; keypad is mouse/touch only |
| Dark mode | ✅ Keypad adapts; some error banners use light-only pastels |
| Reduced motion | ✅ `motion-reduce:active:scale-100` on keypad |

## 6.4 Platform coverage

| Platform | Owner login | Staff PIN | Biometric | Back office |
|----------|-------------|-----------|-----------|-------------|
| Android native | ✅ | ✅ Keypad | ✅ | ✅ |
| iOS native | ✅ | ✅ Keypad | ✅ Face/Touch ID | ✅ |
| Web browser | ✅ | ✅ PinInput fallback | ❌ hidden | ✅ PIN only |
| Windows/Electron | ✅ | ✅ | ❌ unless Capacitor exposes | ✅ PIN only |

## 6.5 UX score: **5.6 / 10**

---

# 7. Enterprise Authentication Standard (Target — Documentation Only)

## 7.1 Target PIN UX (banking-grade)

```
••••
1 2 3
4 5 6
7 8 9
  0
```

| Requirement | Target | Current |
|-------------|--------|---------|
| Length | 4 digits everywhere | ❌ 4, 6, and 8 coexist |
| Auto-focus | On open | 🟡 Partial |
| Auto-submit | After digit 4 | ❌ Never |
| Enter / OK button | None | ❌ Lock/Submit everywhere |
| Correct PIN | Immediate unlock | 🟡 After extra tap |
| Wrong PIN | Shake + red + message + auto-clear | ❌ Text error only |
| Haptics | Consistent on tap + error | ❌ Not on PIN surfaces |
| Lockout | Unified policy | ❌ Multiple policies |
| Accessibility | WCAG AA, aria-live errors | 🟡 Partial |

## 7.2 Target password UX

| Requirement | Target | Current |
|-------------|--------|---------|
| Min 8 chars | All owner paths | 🟡 Local mode = 4 |
| Visibility toggle | All password fields | ❌ Login only |
| Strength meter | Register + reset + change | ❌ Register only |
| Same error copy (i18n) | All surfaces | ❌ Admin hardcoded |
| Loading state | Consistent | 🟡 Per-page |
| Recovery flow | Email + phone parity | ❌ Phone not in UI |

## 7.3 Target architecture

- Single **`EnterpriseAuthService`** facade over verify paths
- Single **`EnterprisePinPad`** component
- Single **`EnterprisePasswordField`** component
- Single **`EnterpriseUnlockShell`** (fullscreen + modal variants)
- Deprecate `verifyOwnerPin`, remove `BiometricAuthModal`
- One lockout policy configurable in settings

---

# 8. Authentication Component Certification

| Component | Certification | Notes |
|-----------|---------------|-------|
| **EnterprisePinKeypad** | 🟡 Partial | Shared keypad; requires Lock button; maxLength 4 default but callers override to 6 |
| **PinInput** | 🟡 Partial | Good Android keyboard workarounds; not a keypad; used for unequal flows |
| **EnterpriseStaffLockScreen** | 🟡 Partial | Best native integration; still requires Lock tap |
| **EnterpriseStaffLoginPanel** | 🟡 Partial | Dual submit (Lock + form) |
| **BackOfficeUnlockModal** | 🟡 Partial | Split mobile/desktop UX |
| **EnterpriseSecurityDialog** | 🟡 Partial | Active SSOT for step-up; PinInput not keypad; hardcoded error colors |
| **BiometricAuthModal** | ⚪ Dead | Orphaned duplicate |
| **ManagerPinModal** | 🔴 Duplicate | Should use enterprise shell |
| **PharmacyControlledApprovalModal** | 🔴 Duplicate | 8-digit ad-hoc input |
| **PharmacyControlledDispenseGate** | 🔴 Duplicate | Inline verify |
| **FloatVerifyOverrideModal** | 🔴 Duplicate | Ad-hoc input |
| **BackOfficePinForm** | 🟡 Partial | Configuration not unlock — acceptable separate flow |
| **SensitiveActionGate** | ✅ Certified | Thin gate; delegates to dialog |
| **SettingsChangeGate** | ✅ Certified | Wrapper only |
| **GoogleSignInButton** | ✅ Certified | Single OAuth entry |
| **LoginPage password field** | 🟡 Partial | Only surface with visibility toggle |
| **useAuth** | 🟡 Partial | Central but no context provider |
| **EnterpriseSecurityService** | ✅ Certified | Verification SSOT |
| **staffLoginLimiter** | ✅ Certified | Progressive lockout |
| **biometricAuth.ts** | 🟡 Partial | Native only; no web fallback beyond PIN |

**Summary:** ✅ 5 · 🟡 11 · 🔴 4 · ⚪ 1

---

# 9. Biometric Audit

| Capability | Status | File | Notes |
|------------|--------|------|-------|
| Fingerprint (Android) | ✅ Production | `biometricAuth.ts` | Via Capacitor plugin |
| Face ID / Touch ID (iOS) | ✅ Production | same | `biometryType` exposed |
| Windows Hello | ⚪ Not explicit | — | No string/reference; depends on plugin |
| Web biometrics | ❌ Disabled | All consumers gate `isNativePlatform()` | PIN fallback only |
| Device credential fallback | ✅ | `allowDeviceCredential: true` | OS PIN/pattern |
| Biometric → PIN fallback | ✅ | `SensitiveActionAuthContext` | After 3 failures |
| Lock screen biometric | ✅ | `EnterpriseStaffLockScreen` | Current session only |
| Back office biometric | ✅ | `BackOfficeUnlockModal` | Owner/manager actors only |
| Settings toggle | ✅ | `BiometricAuthSettingsForm` | Requires shop PIN first |
| Dead code | ⚪ | `BiometricAuthModal.tsx` | Remove in Phase 18.1 |

---

# 10. Enterprise Authentication Score

| Dimension | Score | Phase 18.0 notes |
|-----------|-------|------------------|
| **Authentication Architecture** | **7.2 / 10** | Sound layering; dual PIN systems and legacy APIs drag score |
| **PIN Consistency** | **4.2 / 10** | Multiple lengths, submit patterns, and UIs |
| **Password Consistency** | **5.4 / 10** | Login polish; other flows uneven |
| **Security Policies** | **6.1 / 10** | Good hashing/lockout on lock screen; gaps on manager modals |
| **Accessibility** | **6.3 / 10** | Touch targets OK; aria-live and keyboard gaps |
| **Enterprise UX** | **5.6 / 10** | Not banking-grade; extra taps, no shake/haptics |
| **Overall Authentication Readiness** | **5.8 / 10** | **Not certified** |

### Comparison to target (post Phase 18.1 implementation)

| Dimension | Current | Target after consolidation |
|-----------|---------|----------------------------|
| PIN Consistency | 4.2 | 9.5+ |
| Password Consistency | 5.4 | 9.0+ |
| Enterprise UX | 5.6 | 9.0+ |
| **Overall** | **5.8** | **9.0+** |

---

# 11. Unlock Flow Summary

| Flow | Entry | Steps | Enter required | Auto-submit | Cancel | Timeout |
|------|-------|-------|----------------|-------------|--------|---------|
| Owner POS lock | Auto-lock / manual lock | Switch user? → PIN → Lock | ✅ | ❌ | Emergency logout | Auto-lock timer |
| Staff login | `/login` | Business → name → PIN → Lock → Submit | ✅ | ❌ | Back to owner login | — |
| Back office | Navigate to `/office/*` | Modal → PIN/biometric → Submit | ✅ | ❌ | Navigate away | 5 min session |
| Sensitive action | Protected route/action | Dialog → biometric or PIN → Submit | ✅ | ❌ | Cancel button | 5 min session |
| Device activation | First login / new device | Registration flow (not PIN) | — | — | — | — |
| Recovery | Cloud recovery screen | Owner re-login (password) | ✅ | ❌ | — | — |

---

# 12. Recommended Phase 18.1 Implementation Order (Future — Not This Phase)

1. **`EnterprisePinPad`** — 4-digit auto-submit, shake, haptics, unified lockout hook
2. **`EnterprisePasswordField`** — visibility toggle, 8-char validation, i18n errors
3. Migrate **lock screen → back office → security dialog** (highest traffic)
4. Migrate **hospitality/pharmacy/day-close** modals to shared pad
5. Remove **`BiometricAuthModal`**, deprecate **`verifyOwnerPin`** call sites
6. Unify lockout policy in **`SettingsStaffSecurityPage`** + apply to all PIN surfaces
7. Replace **`window.prompt`** on staff reset with enterprise dialog
8. Align **internal admin** password panels with i18n + shared password field
9. Add **aria-live** error regions and shake animation tokens
10. Certification re-run → target **9.0+**

---

# 13. Verification Statement

| Success criterion | Met? |
|-----------------|------|
| Every PIN implementation identified | ✅ |
| Every password workflow documented | ✅ |
| Every duplicate component located | ✅ |
| Enterprise authentication standard defined | ✅ |
| All inconsistencies documented | ✅ |
| No implementation or code changes | ✅ |

**Phase 18.0: Audit complete. Product not certified for enterprise authentication UX.**

---

## Appendix — Key file index

```
src/hooks/useAuth.ts
src/lib/auth/
src/lib/staffSecret.ts
src/lib/staffOfflineAuth.ts
src/lib/staffLoginSecurity.ts
src/lib/enterpriseSecurity/
src/lib/sensitiveActionAuth.ts
src/lib/biometricAuth.ts
src/lib/backOfficeUnlock.ts
src/context/BackOfficeSessionContext.tsx
src/context/SensitiveActionAuthContext.tsx
src/components/auth/EnterprisePinKeypad.tsx
src/components/auth/EnterpriseStaffLockScreen.tsx
src/components/auth/EnterpriseStaffLoginPanel.tsx
src/components/security/EnterpriseSecurityDialog.tsx
src/components/security/BiometricAuthModal.tsx (dead)
src/components/ui/PinInput.tsx
src/components/layout/BackOfficeUnlockModal.tsx
src/pages/LoginPage.tsx
src/pages/RegisterPage.tsx
src/pages/ResetPasswordPage.tsx
src/pages/SettingsPasswordPage.tsx
docs/PHASE_12_STAFF_PIN_AUTH_AUDIT.md (partially outdated)
```

---

*End of Phase 18.0 read-only audit. No application code was modified.*
