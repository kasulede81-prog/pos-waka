# Phase 40.0 — Enterprise Login & Authentication Entry Certification

**Date:** 2026-08-11  
**Mode:** READ-ONLY forensic audit (no source code modified)  
**Production target:** WAKA POS — Web + Android + iOS/Capacitor  

---

## Executive verdict

### **CONDITIONAL GO**

The **authentication engine is fundamentally sound** and should be **preserved**:

- Supabase email/password sign-in  
- Enterprise local-first logout (`performEnterpriseLogout`)  
- Session restore via `resolveStartupSession`  
- Staff offline PIN path (separate from owner cloud login)  
- Route guards + onboarding/device/subscription gates  
- Organization-deletion blocks on workspace bootstrap  
- Google/OAuth plumbing (feature-flagged; often off in prod)

The **Login UI / entry experience** is functional but **visually and UX-underpowered** for a production POS brand: card-in-cream layout, soft hierarchy, dead “Remember me” control, busy loading as “…”, and several copy/consistency gaps (phone vs email, Google default-off).

**Recommended next phase:** presentation + auth UX rebuild **without** replacing Supabase / logout / guards unless a concrete engine defect appears.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| `/login` + AuthLayout | Redesign implementation |
| Owner + staff entry | Changing auth policies |
| Session restore / logout / deletion interaction | Live credential attacks |
| Forgot/reset/register/OAuth mapping | Production data changes |

---

## Exact files / functions

| Area | Path | Symbols |
|------|------|---------|
| Route | `src/App.tsx` | `/login` → `LoginPage` |
| Login UI | `src/pages/LoginPage.tsx` | `submit`, owner/staff toggle |
| Chrome | `src/components/AuthLayout.tsx` | brand, lang, theme, legal footer |
| Password | `src/components/auth/EnterprisePasswordField.tsx` | show/hide, caps hint |
| Staff panel | `src/components/auth/EnterpriseStaffLoginPanel.tsx` | shop + PIN |
| Google UI | `src/components/auth/GoogleSignInButton.tsx` | |
| Auth engine | `src/hooks/useAuth.ts` | `signIn`, `signInWithGoogle`, `signInStaff`, `signOut`, listeners |
| Logout | `src/lib/auth/enterpriseLogout.ts` | `performEnterpriseLogout` |
| Session restore | `src/lib/offlineSessionResilience.ts` | `resolveStartupSession` |
| Errors | `src/lib/authConfig.ts` | `formatAuthError`, redirect error stash |
| Guards | `ProtectedRoute`, `OwnerProtectedRoute`, `RoleProtectedRoute`, `OnboardingRouteGate`, `NativePublicGuard` | |
| Forgot / reset | `ForgotPasswordPage`, `ResetPasswordPage`, `passwordRecoverySession.ts` | |
| Register | `RegisterPage.tsx` | `signUp` / `signUpQuick` |
| Deletion gate | `organizationDeletionState.ts` | checked in `ensureWorkspaceForSession` |
| Native OAuth | `nativeGoogleAuth.ts`, `nativeAuthDeepLink.ts` | |

---

## Current login journey (code)

```text
App launch
  → useAuth initializing
  → resolveStartupSession / local session / staff restore
  → authenticated?
        YES → ProtectedRoute tree → (onboarding / device / subscription gates) → Home `/`
        NO  → native: /login | web: often /home marketing; /login when navigating to sign-in
LoginPage (owner)
  → email + password (+ optional Google if flag on)
  → signInWithPassword
  → apply session + ensureWorkspace (deletion check here)
  → isAuthenticated → Navigate `/`
Staff path
  → EnterpriseStaffLoginPanel
  → authenticateOfflineStaff (clears Supabase session)
  → staff session into app
```

Post-login landing is **`/` (HomePage)**, not `/pos` or `/office` by default.

---

## Visual login audit

| Area | Assessment | Score |
|------|------------|------:|
| Branding | `WakaPosLogo` in header + small symbol in card; cream wash + orange blobs | 6.5 |
| Logo hierarchy | Header logo competes with in-card symbol; brand not hero-level | 6.0 |
| Typography | Bold welcome; readable; generic “Welcome back!” | 6.5 |
| Spacing / hierarchy | Dense card; many equal-weight secondary actions | 6.0 |
| Background | `bg-brand-cream-wash` + blurs — atmosphere present, slightly template-like | 6.5 |
| Form layout | Single-column max-w-md; solid for phone | 7.5 |
| Inputs | 48px min-height; left icon; focus ring | 7.5 |
| Password | Show/hide via `EnterprisePasswordField` | 8.0 |
| Primary button | Strong waka-600; loading shows “…” only | 6.5 |
| Errors | Red banner; email-confirm link when matched | 7.0 |
| Forgot / register | Present; register as secondary row | 7.5 |
| Support / legal | Footer + support card | 8.0 |
| Language / theme | Present in AuthLayout | 8.0 |
| Responsive | Phone-first card; desktop = same narrow column (acceptable, not premium) | 6.5 |

**Visual overall:** usable, not yet “premium POS product entry.”

---

## Mobile-first audit

| Check | Forensic result |
|-------|-----------------|
| Shared WebView path | ✅ same React login |
| Scroll root | ✅ `auth-scroll-root` / `auth-scroll-pane` (Android Chrome-oriented) |
| Safe areas | ✅ top/bottom env insets on AuthLayout |
| Touch targets | Mostly ≥48px; language toggle **40px** (below 44px guidance) |
| Keyboard | Scroll pane should allow fields to remain reachable — **NOT VERIFIED** on device lab |
| Landscape | Content scrolls — **NOT VERIFIED** |
| Android first-class | Architecture yes; visual lab OPEN |

---

## Desktop / tablet

Same `max-w-md` centered card. No split-brand desktop composition. Scales safely; does not feel like a dedicated desktop auth experience. Acceptable for CONDITIONAL GO; rebuild can add optional two-column desktop without marketing clutter.

---

## Form UX

| Control | Finding |
|---------|---------|
| Email | Labeled; `type=email`; autocomplete; required |
| Phone as owner login | **Rejected** by `signIn` if no `@` — UI is email-only (correct vs hint elsewhere) |
| Password | Show/hide; `autoComplete=current-password`; default `minLength={8}` may block shorter legacy passwords |
| Remember me | **UI-only** — state never passed to auth (`rememberMe` unused) — misleading |
| Submit | `busy` disables button; Enter submits form |
| Double-submit | Soft lock via `busy`; no request coalescing beyond that |
| Loading | Button text “…” — weak affordance |

---

## Error handling

| Case | Behavior |
|------|----------|
| Wrong password / unknown user | Supabase error → `formatAuthError` (may be generic) |
| Empty fields | HTML `required` |
| Unconfirmed email | Explicit message + Resend link |
| Network | Depends on Supabase client error text |
| Deleted org after auth | Workspace ensure → stash `ORGANIZATION_DELETED_MESSAGE` → signOut → login shows message |
| Google disabled | Clear “not available” if invoked |

**Account enumeration:** NOT deeply hardened client-side (standard GoTrue behavior). Staff has lockout; **owner login has no client rate limiter**.

---

## Loading / double submission

- Owner + Google use local `busy` / `googleBusy`  
- No global auth mutex on login page  
- Slow networks: button disabled until promise settles  
**NOT VERIFIED:** race of double Enter before React re-render  

---

## Session restoration & logout

| Scenario | Code expectation |
|----------|------------------|
| Normal restart with session | `resolveStartupSession` restores; user stays in |
| After enterprise logout | Tokens cleared; hard navigate `/login`; should stay logged out |
| Offline SIGNED_OUT deferral | May keep cached session when offline — intentional resilience |
| Deleted org | Blocked at workspace ensure / staff offline checks |

Live “close app after logout” matrix: **NOT VERIFIED** this audit (engine + tests for enterprise logout exist).

---

## Redirect safety

| Check | Result |
|-------|--------|
| Authenticated on `/login` | `<Navigate to="/" />` |
| Unauthenticated protected | → `/login` (or native entry) |
| Post-auth destination | `/` or `/onboarding` via gates / `resolvePostAuthDestination` |
| Flash of protected content | Mitigated by `initializing` + AuthLayout skeleton |
| Loops | No obvious login↔home loop in code; device/email gates can bounce — **lab OPEN** |

---

## Authorization vs authentication

Login authenticates identity. Permissions via `SessionActorContext` + `RoleProtectedRoute` / feature gates. Owner-only pages use `OwnerProtectedRoute`. Frontend checks are not the sole backend boundary for RLS/edge.

---

## Google / OAuth

| Item | Status |
|------|--------|
| Implementation | Present (web GIS id-token; native browser OAuth + deep link) |
| Default feature flag | `VITE_ENABLE_GOOGLE_AUTH` — **UI typically off** unless enabled |
| Mobile WebView | Native path avoids GIS-in-WebView pitfalls |

Treat as **implemented but often unavailable in UI**, not “NOT IMPLEMENTED.”

---

## Password reset

```text
/forgot-password → requestPasswordReset
  → email: resetPasswordForEmail
  → non-email: lookup_password_reset_email (phone)
→ email link → /reset-password → updatePassword → signOut → /login
```

Forgot UI is `type="email"` while backend supports phone lookup — **copy/UI mismatch (P2)**.

Deep-link on native: recovery URLs use public `pos.waka.ug` — **device lab NOT VERIFIED**.

---

## Registration

`/register` → `signUp` → onboarding or verify-email. Links from login. Requirements not contradictory with email login; register collects phone for account identity separately.

---

## Account deletion interaction (Phase 39)

```text
Delete success → local wipe → enterprise logout → /login
```

On next sign-in attempt for wiped org: `ensureWorkspaceForSession` / deletion refresh should refuse and surface deleted message. Staff offline auth also checks wipe/deletion markers.

**NOT VERIFIED:** full staging delete → reopen → login matrix in this audit.

---

## Offline login

| Mode | Exists? |
|------|---------|
| Owner cloud login offline | No meaningful new session without Supabase (cached restore may keep prior session) |
| Staff PIN offline | **Yes** — requires shop cache previously synced |
| Local mode (no Supabase config) | Dev/fallback local email session |

---

## Security

| Topic | Assessment |
|-------|------------|
| Password transit | Supabase Auth |
| Token persistence | Supabase client + enterprise logout clearing |
| Owner brute-force client limit | **Absent** (P2/P1 depending on threat model) |
| Staff lockout | Present |
| Error leakage | Partially sanitized via `formatAuthError` |
| OAuth state | Native/deep-link path present |
| Redirect host validation | `authConfig` unsafe-host guards |

No P0 found in repository forensics for login bypassing auth.

---

## Accessibility

| Check | Result |
|-------|--------|
| Labels | Present on email/password |
| Password toggle | Present |
| Error `role` | Not always announced as alert |
| Focus order | Natural form order |
| Language control | 40px height — below 44px |
| Contrast | Generally OK on cream/card |

---

## Performance

- Auth init can hold Login on skeleton (`initializing`)  
- iOS `getSession` stall historically mitigated by startup timeout paths  
- Duplicate listeners: single `useAuth` in AppRoutes — good  
- Post-login workspace ensure is async (non-blocking after session set)

---

## Cross-platform

Shared React auth. Platform branches: native Google OAuth browser, deep links, splash gate, native public path → `/login`. No iPhone-only login UI.

---

## Score

| Dimension | Score |
|-----------|------:|
| Visual design | **6.5** |
| Mobile UX | **7.0** |
| Desktop UX | **6.5** |
| Form UX | **6.5** |
| Authentication reliability | **8.5** |
| Session management | **8.5** |
| Logout integration | **9.0** |
| Account deletion integration | **8.0** |
| Error handling | **7.5** |
| Security | **7.5** |
| Accessibility | **7.0** |
| Performance | **7.5** |
| Cross-platform readiness | **8.0** |
| **OVERALL** | **7.5 / 10** |

---

## Findings

### P0
None identified in code forensics.

### P1 — major UX / trust
| ID | Finding |
|----|---------|
| LG-1 | Login visual identity under-delivers for enterprise POS (generic welcome card; weak brand hero) |
| LG-2 | “Remember me” control does **nothing** (misleading trust control) |

### P2 — important polish
| ID | Finding |
|----|---------|
| LG-3 | Submit loading state is “…” — poor feedback |
| LG-4 | Password field default `minLength={8}` on login may block valid shorter credentials |
| LG-5 | Forgot-password UI email-only vs phone lookup in hook |
| LG-6 | Google often hidden by feature flag — owners may assume SSO missing |
| LG-7 | No client-side owner login rate limiting |
| LG-8 | Language toggle & some chrome &lt; 44px |
| LG-9 | Desktop layout is stretched mobile card only |

### P3
| ID | Finding |
|----|---------|
| LG-10 | Dual “or” dividers / stacked secondary CTAs feel busy |
| LG-11 | Error banner not consistently `role="alert"` |
| LG-12 | Dark mode card uses `dark:bg-foreground` patterns that can feel inverted |

---

## What must be preserved

1. `useAuth` + Supabase `signInWithPassword` / session listener model  
2. `performEnterpriseLogout` local-first teardown  
3. `resolveStartupSession` resilience  
4. Staff offline PIN path + lockout  
5. Route guards + onboarding/device/subscription gates  
6. Organization deletion refusal on workspace ensure  
7. Auth callback / recovery pipelines  
8. Native deep-link OAuth architecture (when Google enabled)  
9. `formatAuthError` / redirect error stash  
10. Auth scroll root for Android keyboard/viewport  

---

## What should be rebuilt (UI / UX only)

Prioritized for next phase:

1. **Login visual system** — brand-first, POS-trustful, quieter hierarchy  
2. **Remove or wire Remember me** honestly  
3. **Proper loading / disabled / error announcement**  
4. **Login password rules** (don’t use signup minLength blindly)  
5. **Align forgot-password identifier UX** with backend  
6. Optional desktop split layout (still product, not marketing landing)  

**Do not** rewrite Supabase auth, logout, or guards unless a defect is proven.

---

## Recommended login design (spec only — DO NOT IMPLEMENT)

### Mobile hierarchy (first viewport)

1. WAKA wordmark / symbol (hero-level, quiet)  
2. Short line: “Sign in to sell” (POS, not social app)  
3. Email  
4. Password + show/hide + Forgot  
5. Primary **Sign in** (full width, ≥52px, real loading label)  
6. Secondary: Staff PIN · Create account  
7. Support / legal in footer  

Avoid: marketing hero collage, fake stats, purple glow, giant illustration.

### Desktop

Centered form **or** soft split (brand panel + form). Same components; no separate auth engine.

### States

- Loading auth init  
- Submitting  
- Error (alert)  
- Unverified email  
- Organization deleted  
- Offline staff path  

---

## Recommended next phase

### **Phase 40.1 — Enterprise Login Experience Rebuild**

**Mode:** PRESENTATION + AUTH UX only  

Preserve authentication backend, logout, session restore, staff PIN, deletion gates.  
Fix LG-1…LG-5 as minimum; consider LG-6–LG-9.

Do **not** start until this audit is accepted.

---

## Verification performed

| Check | Result |
|-------|--------|
| Code trace of login → auth → redirect | Done |
| `enterpriseLogout` tests | 3/3 pass |
| Live device keyboard / landscape lab | **NOT VERIFIED** |
| Staging delete → login resurrection | **NOT VERIFIED** (code path present) |
| Production Google flag state | Config-dependent |

---

## Final verdict

**CONDITIONAL GO**

Authentication architecture: keep.  
Login entry UI/UX: rebuild in Phase 40.1.  
No source changes in this phase.

---

*End of Phase 40.0 — read-only certification. No source code was modified.*

---

### Phase 40.1 — Enterprise Login Experience Rebuild

**Date:** 2026-08-11  
**Mode:** Presentation + auth UX only (auth engine preserved)  
**Prerequisite:** Phase 40.0 CONDITIONAL GO

#### Fixed (from 40.0)

| ID | Repair |
|----|--------|
| LG-1 Branding | WAKA logo hero + **Sign in to sell**; quieter card; POS-focused |
| LG-2 Remember me | **Removed** (was non-functional) |
| LG-3 Loading | **Signing in…** label |
| LG-4 Login minLength | Login password uses `minLength={1}` (signup strength unchanged) |
| LG-5 Forgot identifier | Email **or** Uganda phone field aligned with `requestPasswordReset` |
| LG-8 Touch targets | Auth lang control ≥44px; password visibility ≥44px; forgot link ≥44px |
| LG-10 Hierarchy | Single secondary “or” block; Staff PIN + Create account; support link simplified |
| A11y | Login/forgot errors use `role="alert"` |

#### Preserved

- `useAuth` / Supabase / Google flag path  
- Staff PIN panel (separate view)  
- `performEnterpriseLogout` / session restore / deletion gates  
- Route guards  

#### Files changed

- `src/pages/LoginPage.tsx`  
- `src/pages/ForgotPasswordPage.tsx`  
- `src/components/AuthLayout.tsx`  
- `src/components/auth/EnterprisePasswordField.tsx`  
- `src/lib/i18n.ts`  

#### Remaining

- Device lab (keyboard / Android / iOS) for login form  
- Owner client rate-limit still deferred (engine policy)  
- Google UI still feature-flag gated  

#### Verdict

**CONDITIONAL GO** — login UX rebuilt; auth engine untouched; visual device QA OPEN.

*End of Phase 40.1 notes.*
