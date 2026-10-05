# DKASU POS — Loyalty Phase 2 Audit (Complete Source of Truth)

Audit date: 2026-10-05. Audit-only session: no source code, database code, or tests were modified.
Repository state audited: `main` @ `26ed686d` (working tree clean except this document).
Framework used: `loyalty-phase-2-audit-prompt.md` (existing Loyalty audit specification), re-executed
against the current repository rather than trusting prior conclusions.

---

## 1. Executive Summary

Phase 1 of the Loyalty UI/UX redesign shipped: the merchant Loyalty hub is now a six-section,
URL-routed workspace (`/office/loyalty/:section`) wrapped in a shared `LoyaltyShell`, gated by
`customers.view`, with a permission-aware tab bar. The IA works, the tests for it pass, and the
underlying Loyalty product is feature-rich (enrollment, QR/NFC identity, rewards, redemptions,
redemption reversal, customer 360, spend promotions, enrollment requests, card design, wallet,
public join flows, checkout integration) with an extensive protected backend.

What Phase 1 did **not** do is raise the hub to the interaction quality of the rest of DKASU.
The audit found the hub still runs on ad-hoc loading/error text, has **no retry affordance** when
the initial load fails, performs **balance-affecting actions with silent or misleading failure
feedback**, confirms redemptions inline instead of with the enterprise confirmation dialog, lacks
accessible labels on its search/filter controls, misses touch-target minimums, bypasses the shared
`WakaButton` design system, and re-fetches the same data in several panels. Translation coverage
for Loyalty is structurally complete for Luganda but only 37% for Swahili (305 of 481 keys fall
back to English).

**Phase 2 = a focused "experience hardening" phase**: standardized data states with recovery,
safe and honest action flows, accessibility and touch-target compliance, and design-system
alignment — across the six existing sections, without touching the IA, the backend, or the
permission model. It is four small batches, all frontend-only except i18n additions.

---

## 2. Current Loyalty Architecture

Two Loyalty surfaces exist, on different hosts/routes:

**A. Merchant office surface (the Phase 1 redesign target — Phase 2 scope)**

- Routes: `/office/loyalty` and `/office/loyalty/:section`, both wrapped in
  `RoleProtectedRoute permission="customers.view"` (`src/App.tsx` lines 655–673), lazy-loaded
  `LoyaltyHubPage`.
- `src/pages/LoyaltyHubPage.tsx` (~1,675 lines) is the single page. It resolves the section from
  the URL, normalizes legacy tab ids to canonical paths (redirect `replace`), loads
  `loyalty_shop_overview` + `shop_loyalty_usage` on mount, then renders one of six section bodies.
  It also contains inline sub-components: `StatCard`, `HistoryList`, `MemberQrBlock`,
  `CustomerDetail`, `CustomerList`.
- `src/components/loyalty/LoyaltyShell.tsx` (65 lines): `BackOfficePageLayout` + `PageHeader`
  (title = loyalty hub, subtitle = section-specific, back → `/office`) + `HorizontalTabBar`.
- `src/lib/loyalty/loyaltyNav.ts`: section ids, path builders, i18n key maps, legacy-id resolution,
  and `loyaltySectionsForActor({ canManage })` which hides only `rewards` from non-managers.
  Unit-tested by `src/lib/loyalty/loyaltyNav.test.ts` (3 tests, passing — verified this session).
- Office entry: `OfficeHubSectionBody.tsx` renders an `OfficeNavCard` (`Gift`, `highlight`) to
  `/office/loyalty`, gated by `customers.view`.
- Data layer: `src/lib/loyalty/loyaltyMerchant.ts` (overview, search, history, program save,
  adjust, renew, lifecycle), `loyaltyRewards.ts` (catalog CRUD, redeem with idempotency key),
  `loyaltyEnrollment.ts` (customer search, consent enroll, token lookup, `WAKA-LOYALTY:` QR),
  `loyaltyUsage.ts`, `loyaltyEnrollmentRequests.ts`, `loyaltyCustomerOffers.ts`,
  `loyaltyErrorMessages.ts` (`loyaltyErrorKey` code→i18n map), plus card-design, program-code,
  public-link, and 360 modules. All RPC-backed; **no client-side point crediting anywhere**.
- Components in `src/components/loyalty/`: 18 files — enrollment, rewards, spend promotions,
  enrollment requests, program code, public enrollment link, card design, member QR, Google Wallet
  buttons, customer offers/rewards/360, code entry, public card view, `WakaLoyaltyCard`,
  `LoyaltyShell`.

**B. Public / member surface (out of Phase 2 scope)**

- `/loyalty/:publicCardToken` (public card), `/join` public signup, public program page,
  `loyalty.waka.ug` customer sign-in (`isLoyaltySurface()` boundary), member dashboard
  (`src/pages/member/MemberHomePage.tsx`, 1,028 lines), member login/register/welcome pages.
- POS checkout integration: `PosCheckoutPanel`, `PosDesktopCatalogCheckoutDock`,
  `PosLoyaltyCustomerRow` (attach/scan/expected-points/claim reward) — protected area.

**Backend**: all listed in §12/§13; security-definer RPCs re-check authorization internally
(`user_can_access_shop` for reads, `user_can_manage_shop` for program config); ledger has no
client write policies.

---

## 3. Phase 1 Baseline

Shipped in commit `26ed686d` (2026-10-05), verified this session:

- Six sections live and URL-backed: `overview | members | rewards | activity | cards | settings`;
  legacy ids (`customers`, `earn`, `design`, `requests`, `history`, …) map to them and the page
  redirects to the canonical path.
- `LoyaltyShell` + `HorizontalTabBar` (`role="tablist"`, `aria-selected`, focus-visible rings,
  44px tabs, horizontal scroll on narrow screens) — single consumer is `LoyaltyShell`.
- Permission-aware navigation: `rewards` tab hidden without `settings.shop`; every other section
  visible to any actor holding `customers.view`.
- Office → Loyalty entry card live.
- i18n keys for tabs/subtitles exist in en, lg and sw.
- `loyaltyNav.test.ts` passes (ran it: 3/3, 1.37s).
- Hub load states exist but are minimal (plain text paragraphs), and the section gate is
  `loadState === "ready" && overview`.

Phase 1 is the foundation: **this audit does not recommend any structural navigation change.**

---

## 4. Complete Loyalty Inventory

| Area | Where | State |
|---|---|---|
| Program overview (status, enable switch, stats, earn rule summary) | hub `overview` | Works; text loading/error; error has no retry |
| Allowance/usage meter (tier, member limit, pending requests count) | hub `overview` | Works; server-authoritative (`shop_loyalty_usage`) |
| Earn-rule settings (simple + advanced, points/membership expiry) | hub `settings` | Works; labels present; raw inputs; validation errors shown at save-time |
| Member list (server-side search + status filter, 50-row cap) | hub `members` | Works; 250ms debounce, seq-guarded; search input unlabeled; filter buttons not `aria-pressed` |
| Member detail (`CustomerDetail`) | hub `members` expand | Balance/lifetime grid, lifecycle actions, expiry editor, QR block, per-member history (50), redeem card, adjust-points drawer |
| Lifecycle (suspend/reactivate/revoke/renew, confirm inline) | `CustomerDetail` | Works; states handled; list-row **renew** button has silent failure (§6 P3) |
| Redeem (two-step inline, idempotency key, rich error mapping) | `CustomerDetail` | Works; inline confirm lacks dialog/balance-after preview; disabled buttons unexplained |
| Adjust points (manual correction) | `CustomerDetail` advanced | Works at RPC level; **silent client-side validation** and **always-"forbidden" error text** (§6 P4) |
| Enrollment (search shop customers → consent → enroll → QR) | `LoyaltyEnrollmentPanel` (members) | Works; sits below the full member list (discoverability) |
| QR/NFC identification | enrollment panel scan card | Works; camera + NFC capability-gated with graceful fallback |
| Customer 360 (spend/returns/redemptions, reversal, lookup fallback) | `LoyaltyCustomer360Panel` | Works; has its own retry — the **only** loyalty panel that does |
| Rewards catalog CRUD (+ product-backed, benefits, expiry, remove-history guard) | hub `rewards` (manager only) | Works; inline remove confirm; empty state is plain text |
| Spend promotions | `LoyaltySpendPromotionsPanel` (rewards tab) | Works; same auth as rewards |
| Activity (aggregate stats + 10 recent rows) | hub `activity` | Works; **server-capped at 10 rows**, no drill-down/pagination |
| Enrollment requests (filter, approve/reject with reason, queue limit) | hub `cards` (manager) | Works; loading/empty present |
| Program code (permanent WPL…, copy/print/QR) | hub `cards` | Works; **re-fetches overview** the hub already has |
| Public enrollment link (regenerate/revoke) | hub `cards` | Works |
| Card design (preview, colors, reset) | hub `cards` (manager) | Works; preview is intentionally dark (artifact, not theme bug) |
| Google Wallet issue/status/sync (merchant + member buttons) | member detail, member app | Works; brand-blue button (acceptable); fail-closed backend |
| Checkout earn/claim row | `PosLoyaltyCustomerRow` | Works; rich claim error map; **protected — not Phase 2** |
| Public card / join / program pages | public routes | Works; light-branded by design (§11) |
| Member dashboard | `MemberHomePage` | Works; dark-aware (`dark:` variants) |

---

## 5. Current Navigation

```
/office  →  OfficeNavCard (Gift, highlight, customers.view)
        →  /office/loyalty            → redirect → /office/loyalty/overview
        →  /office/loyalty/:section   → LoyaltyShell
              ├─ overview   (all roles with customers.view)
              ├─ members    (all)
              ├─ rewards    (settings.shop only — hidden from tab bar otherwise;
              │              deep link shows "owner only" notice, does not crash)
              ├─ activity   (all)
              ├─ cards      (all; management sub-panels gated by canManage)
              └─ settings   (all; form gated, read-only summary for staff)
```

- Section lives in the path; back/forward/refresh/deep-link work; legacy ids normalize with
  `navigate(..., { replace: true })`.
- Switching sections clears the expanded-member state (`onSectionChange → setExpandedId(null)`).
- From `cards`, approving a request can open the member in `members` (cross-section deep action).
- **No navigation redesign is required or recommended.**

---

## 6. UX Problems

Numbered findings (P#). Workflow letters refer to the spec's list A–P.

- **P1 — Hub load failure is a dead end (O, P).** `loadState === "error"` renders a static
  paragraph (`loyaltyUnavailable`). No Retry button; the user must full-page-refresh.
  Everything (all six sections) is gated behind `loadState === "ready" && overview`, so one
  failed overview call blanks the entire workspace. `EnterpriseErrorState` with `onRetry`
  already exists in the codebase and is unused here.
- **P2 — No skeletons anywhere in the hub (O).** Loading = centered text lines. The codebase
  standard is `EnterpriseSkeleton` (variants: kpi/card/list-row/…), used by other modules.
- **P3 — Silent failure: membership Renew in the member list (B).** The list-row renew button
  (`CustomerList`, near line 884) runs `renewLoyaltyMembership` and only calls `onAdjusted()`
  `if (result.ok)` — **failures vanish with zero feedback**, and there is no busy/disabled
  state, so double-taps are possible. (The `CustomerDetail` renew path handles busy+error; only
  the list row is broken.)
- **P4 — Adjust-points: silent validation + misleading error (member management).**
  `submitAdjust` returns early on invalid input (empty note, non-integer/zero points) with no
  inline message — the button appears dead. On RPC failure the UI always shows
  `loyaltyAdjustForbidden`, even for `invalid_points`, `note_required`, `offline`, or
  `loyalty_unavailable`. The correct mapper `loyaltyErrorKey()` already exists
  (`loyaltyErrorMessages.ts`) and is already used by lifecycle errors in the same component.
- **P5 — Redeem confirmation is ambiguous for a financial action (E).** Two-step confirm happens
  inline inside a list row: the Redeem button morphs into "Confirm ⟨N points⟩" with no dialog,
  no reward context, and no "balance after" preview. The enterprise standard is
  `ConfirmationDialog` (keyboard-aware, busy state, destructive variant) used by device/inventory
  modules. The idempotency-key-per-intent flow underneath must not change.
- **P6 — Disabled redeem buttons give no reason (L, zero-point customer).**
  `isRewardEligible` disables the button (opacity-40) with no explanation. A cashier seeing a
  "Redeem" button that does nothing learns nothing. Needs a "needs ⟨n⟩ more points" hint.
- **P7 — Search inputs unlabeled; filters not announced (B, a11y).** Both member search and
  enrollment search expose only `placeholder` (disappears on focus; screen readers announce an
  unlabeled textbox). Status-filter buttons carry no `aria-pressed`.
- **P8 — Success/error text is not announced (N, O, a11y).** Save/redeem/enroll/adjust feedback
  is visually rendered but never in a `role="status"`/`aria-live` region, so screen readers miss
  it.
- **P9 — Touch targets under 44px (responsive).** Status-filter buttons `min-h-[36px]`; redeem/
  lifecycle/inline-confirm buttons `min-h-[40px]`. App standard (and the app's own TabBar,
  search inputs, primary CTAs) is 44–48px.
- **P10 — Raw `<button>`/`<input>` instead of design-system primitives.** The hub uses
  hand-rolled classes for every action while `WakaButton` (40 files) / `WakaInput` / `WakaCard`
  are the DKASU standard. Result: subtle inconsistencies in hover/disabled/pressed states versus
  the rest of the office suite.
- **P11 — Duplicate reads of the same data.** The hub loads `loyalty_shop_overview` and
  `shop_loyalty_usage`; `LoyaltyProgramCodePanel` fetches the overview **again** (for
  `publicCode`), and `LoyaltyEnrollmentRequestsPanel` fetches usage **again**. Two live copies
  of the same numbers on one screen can disagree mid-refresh.
- **P12 — Enrollment discoverability (A).** The enroll panel sits *below* the full member list
  on `members`; on a shop with many members, "add a new member" requires scrolling past
  everything. No in-list affordance jumps to it.
- **P13 — Member list capped at 50, silently (B).** `searchLoyaltyAccounts` hardcodes
  `p_limit: 50`; `loyalty_search_accounts(uuid,text,text,integer)` has **no offset parameter**,
  so honest pagination needs a backend migration. Search mitigates; the cap itself is not
  communicated in the UI.
- **P14 — Activity section shows only the 10 most recent rows (H).** The cap is server-side
  (`loyalty_shop_overview` builds `recentActivity`), so a full activity view requires a backend
  dependency. Per-member history (50 rows) exists in member detail.
- **P15 — Tab bar lacks arrow-key navigation (a11y).** `HorizontalTabBar` has correct
  roles/`aria-selected`/focus rings but follows WAI-ARIA tabs only partially (Tab key works;
  Left/Right arrows do not). `LoyaltyShell` is its **only consumer**, so the blast radius of a
  fix is loyalty itself.
- **P16 — Translation gaps (i18n).** en = 481 loyalty keys; lg = 473 present (8
  `loyaltyWalletMember*` missing → English fallback) with 168 values identical to English;
  sw = 176 overrides → **305 keys (63%) render English** in Swahili. `t()` falls back
  `lang → en → key`, so nothing breaks — but the Swahili Loyalty experience is majority English.
- **P17 — Rewards empty state is a bare paragraph (M).** `loyaltyNoRewards` sits where
  `EnterpriseEmptyState` (icon + title + optional CTA) is the house pattern.
- **P18 — Global section gate amplifies P1.** Because every section renders only when the hub
  overview is `ready`, a failed overview also kills member search (its effect requires
  `loadState === "ready"`). Retry (Batch 1) mitigates; per-section data isolation is a larger
  refactor (Later Phases).
- **P19 — Cards tab opens with a static bullet list** ("QR / wallet / points") explaining the
  feature to the merchant — instructional copy in a work tool; low harm, cosmetic.
- **P20 — Inconsistent feedback timing.** Some actions show inline text ("Saved"), others
  nothing; there is no toast system used in loyalty. Phase 2 keeps inline feedback but makes it
  consistent and live-announced (P8) rather than introducing a new notification pattern.

**What works and should not be touched:** URL routing/legacy mapping; permission-aware tab
hiding; the two-step redeem idempotency flow; consent-gated enrollment; QR/NFC scan; Customer
360 with its own retry; server-side status filtering (filter-before-LIMIT is correct);
seq-guarded debounce search; `loyaltyErrorKey` mapping; the whole backend.

---

## 7. Severity Ranking

| Sev | IDs | Summary |
|---|---|---|
| HIGH | P1, P3, P4 | Dead-end load failure with no retry; silent renew failure; silent/misleading adjust feedback on a balance-affecting tool |
| MEDIUM | P2, P5, P6, P7, P8, P9, P10, P11, P12, P17 | Skeletons, redemption confirmation quality, disabled-reason, a11y labels/announcements, touch targets, design-system drift, duplicate reads, enrollment discoverability, empty states |
| LOW | P13, P14, P15, P16, P18, P19, P20 | Caps needing backend (documented), tab arrow-keys, translation backlog, section-gate refactor, cosmetic copy, feedback consistency |
| OBSERVATION | P-next | Public card surface light-branded (§11); backend allows manager what frontend hides (§8) — both intentional/acceptable |

---

## 8. Permission Findings

Current matrix (verified in `src/lib/permissions.ts` and route/panel code):

| Actor | Route (`customers.view`) | Sections | `canManage` (`settings.shop`) | `loyalty.redeem` | `loyalty.wallet_issue` |
|---|---|---|---|---|---|
| owner | ✓ | all | ✓ | ✓ | ✓ |
| manager | ✓ | all but rewards | ✗ | ✓ | ✓ |
| supervisor | ✓ | all but rewards | ✗ | ✓ | ✓ |
| cashier | ✓ | all but rewards | ✗ | ✓ | ✓ |
| stock_keeper | ✗ (no `customers.view`) | — | — | ✗ | ✗ |
| custom roles | permission-snapshot driven | same rules | as granted | as granted | as granted |

- Route gate uses `actorHasEffectivePermission` (role + subscription tier); internal hub checks use
  `actorHasPermission` (role matrix only). No tier gate exists for loyalty content itself.
- **Finding F1 (no change required):** backend `user_can_manage_shop` accepts
  `shop_members.role in ('owner','manager')` (migration `029_...`), so `loyalty_update_program`
  would accept a manager server-side while the UI hides the controls. This is defense-in-depth
  headroom, **not a user-facing defect**: `settings.shop` gates every settings subpage in the
  product the same way, so "manager cannot edit shop configuration" is the established product
  intent. **Phase 2 does not change any permission.**
- **Finding F2 (no change required):** the `rewards` tab is hidden from staff because it is
  catalog *management*, while staff still *see* the rewards they can redeem inside the member
  detail redeem card (RLS allows members to read rewards). Consistent.
- **Finding F3 (no change required):** deep-linking a hidden section shows an explicit
  "owner only" notice — correct degradation, no crash, no silent blank.
- Frontend gates align with backend RPC re-checks (`user_can_access_shop` / 
  `user_can_manage_shop`); no mismatch that a UI-only phase should "fix".

---

## 9. Responsive Findings

- **Good:** `HorizontalTabBar` scrolls horizontally on narrow screens; member rows truncate
  (`min-w-0` + `truncate`); stat grids use `grid-cols-2 → sm:grid-cols-3`; inputs are fluid
  (`w-full`); sticky header via `BackOfficePageLayout`; no data tables in the hub (list-based),
  so no table overflow risk; `EnterpriseResponsiveTable` exists if ever needed.
- **Issues:** touch targets (P9) — 36px filter pills and 40px action buttons are below the
  44px app norm; on a 320px viewport the redeem row (name + two buttons) is tight but survives
  via truncation; enrollment QR preview `max-w-[320px]` fine; the settings form's number inputs
  `max-w-[220px]` fine.
- **No desktop-shrinking problem:** layouts are single-column-first already. Phase 2 must verify
  at 320/375/768/1280 after the touch-target and dialog changes (dialogs must fit 320px —
  `ConfirmationDialog` already caps `max-h` and centers).

---

## 10. Accessibility Findings

- **Good:** semantic buttons everywhere (no clickable divs in the hub); TabBar roles/focus rings;
  form `<label>` wrapping in settings/rewards; `aria-label` on reward remove and design swatches;
  Customer 360 marks `aria-busy`; NFC/scan controls are real buttons with visible text.
- **Gaps (all in Phase 2):** P7 (unlabeled search inputs, filters without `aria-pressed`),
  P8 (no `role="status"` live regions for async feedback), P15 (tab arrow-key navigation),
  P6 (disabled controls without announced reason). Confirm dialogs after P5 improve keyboard
  safety for the most dangerous action. Contrast: token-based text (`foreground`/
  `muted-foreground` on `card`) follows the app theme; no custom contrast violations found in
  hub components.

---

## 11. Dark Mode Findings

- Hub and loyalty panels use theme tokens (`bg-card`, `border-border`, `text-foreground`,
  `bg-muted`, `bg-waka-*`, `success/warning/destructive` tints); `src/index.css` remaps these
  under `.dark` (including `.dark .bg-waka-50`), so existing screens adapt correctly.
- **Justified non-token whites:** QR image containers (`LoyaltyMemberQr`, program-code QR,
  public-enrollment QR, camera preview `bg-black`) — a QR must sit on white to scan. Not bugs.
- **Artifact, not theme:** card-design preview (`border-slate-900 bg-slate-900`) simulates a
  physical card; `PublicLoyaltyCardView` is a deliberately light-branded wallet-style surface
  (orange/slate palette, self-contained white cards) — it renders identically under `.dark`,
  which is acceptable for a public share page. **No Phase 2 change; documented as by design.**
- Phase 2 additions (skeletons, dialog usage, buttons, status text) all come from theme-aware
  components, so dark mode is preserved by reuse. A dark-mode visual check of every touched
  screen is an acceptance criterion.

---

## 12. Backend Dependencies (reuse only — nothing new to build)

All Phase 2 needs already exists. Client layer → RPC:

| Capability | Client | RPC / source |
|---|---|---|
| Overview + aggregates + 10 recent rows + publicCode | `loyaltyMerchant.fetchLoyaltyOverview` | `loyalty_shop_overview` |
| Program save | `saveLoyaltyProgram` (+ `validateProgramInput` client guard) | `loyalty_update_program` |
| Member search (status filter before LIMIT, `p_limit`) | `searchLoyaltyAccounts` | `loyalty_search_accounts` |
| Per-member history | `fetchAccountHistory` | `loyalty_transactions` select (RLS) |
| Adjust points | `adjustLoyaltyPoints` | `loyalty_adjust_points` |
| Renew membership | `renewLoyaltyMembership` | `loyalty_renew_membership` |
| Lifecycle | `setLoyaltyAccountLifecycle` | `loyalty_set_account_lifecycle` |
| QR token | `fetchLoyaltyAccountQrToken` | account QR read (RLS) |
| Enrollment | `enrollCustomerWithConsent`, `fetchShopCustomersForEnrollment` | `loyalty_enroll_customer`, `shop_customer_search` |
| Token identification | `lookupAccountByToken` | `loyalty_account_by_token` |
| Rewards catalog | `fetchLoyaltyRewards`, create/update/delete | `loyalty_rewards` (RLS), `loyalty_delete_unused_reward` |
| Redemption | `redeemLoyaltyReward` (idempotency key, `newRedemptionIdempotencyKey`) | `loyalty_redeem_reward` |
| Usage / allowance | `loyaltyUsage` | `shop_loyalty_usage` |
| Enrollment requests | `loyaltyEnrollmentRequests` | `loyalty_list_enrollment_requests`, `loyalty_review_enrollment_request` |
| Customer 360 | `LoyaltyCustomer360Panel` | `shop_customer_360` |
| Offers / spend promotions | `loyaltyCustomerOffers` | `loyalty_list_customer_offers`, `loyalty_create_customer_offer`, … |
| Card design | `loyaltyCardDesign` | `loyalty_upsert_card_design`, `loyalty_reset_card_design` |
| Program code / join link | `loyaltyProgramCode`, `loyaltyPublicProgram` | overview `publicCode`, `buildProgramJoinUrl` |
| Wallet sync | `requestGoogleWalletBalanceSync` | existing queue |
| Error mapping | `loyaltyErrorKey` / `memberWalletErrorKey` | client-side |

**Known backend gaps** (documented, NOT built in Phase 2): no `p_offset` on
`loyalty_search_accounts` (member pagination); `recentActivity` hard-capped at 10 server-side
(full activity view). Both → Later Phases (§24).

---

## 13. Protected Systems (must not change)

- **Ledger & points engine:** `loyalty_accounts`, `loyalty_transactions`,
  `loyalty_point_lot_allocations`; `trg_loyalty_tx_balance` and
  `balance = lifetime_earned − lifetime_redeemed`; `loyalty_award_for_sale`,
  `loyalty_reverse_for_sale`, `loyalty_reverse_for_return`, `loyalty_apply_pending_reversals`,
  `loyalty_allocate_fifo`, `loyalty_expire_due_points`, `loyalty_assert_balance_invariant`;
  non-negative balance CHECK; ledger immutability (no client writes); award-on-sale trigger path;
  return/void reversal semantics. **Never client-credit points.**
- **Redemption integrity:** `loyalty_redeem_reward` row-lock + idempotency model;
  `loyalty_redemptions` snapshot; `loyalty_apply_redemption_to_sale` clamp; 
  `loyalty_reverse_redemption`; redemption idempotency indexes.
- **Enrollment & identity:** `loyalty_enroll_customer`, `loyalty_enrollment_links`,
  `loyalty_enrollment_requests` data model; `qr_token` secrecy; `WAKA-LOYALTY:` payload
  (`LOYALTY_QR_PREFIX`); `loyalty_account_by_token`; abuse-protection/cooldown logic.
- **Everything else:** RLS policies; Google Wallet backend (`loyaltyWallet` service, edge
  function, signers); checkout loyalty accounting (`PosCheckoutPanel`,
  `PosLoyaltyCustomerRow`, preview hooks); NFC adapter; public-card edge routes/tokens;
  subscription/entitlement system; auth/staff architecture.
- **No migration files may be added or edited in Phase 2.**

---

## 14. Recommended Information Architecture

**Keep Phase 1 exactly as is** — six sections, URL-backed, `LoyaltyShell`, permission-aware tab
hiding. Phase 2 operates *inside* the sections. The only positional recommendation inside scope:
a jump-to-enroll affordance on `members` (P12) — an anchor CTA, not a new section or route.

---

## 15. Phase 2 Objective

Make the existing six-section Loyalty hub feel like one coherent, professional DKASU workspace:
every workflow gets proper loading / empty / success / error / disabled states with recovery;
every balance-affecting action is confirmed and reports honest feedback; the hub meets the
project's accessibility and touch-target standards; and the UI is built from the shared
design-system primitives — with zero changes to IA, backend, permissions, or Loyalty accounting.

---

## 16. Phase 2 Scope (IN SCOPE)

1. **Hub data states:** `EnterpriseSkeleton` while loading; `EnterpriseErrorState` with Retry on
   hub load failure (re-run `loadOverview` + `loadUsage`); `role="status"` live regions around
   existing inline feedback (save/redeem/enroll/adjust/lifecycle).
2. **Panel state standardization:** skeleton or labeled loading for `MemberQrBlock`, member
   history, program code, enrollment requests; `EnterpriseEmptyState` for the two card-level
   empties (member search results, rewards catalog); keep nested inline empties (activity list)
   as-is.
3. **Redeem confirmation dialog:** move the confirm step into `ConfirmationDialog` showing
   reward name, point cost, and balance after; keep the existing pending-key/idempotency
   behavior and all error mapping.
4. **Silent-failure fixes:** list-row renew gets busy state + error message via
   `loyaltyErrorKey`; adjust-points gets inline validation feedback + `loyaltyErrorKey` mapping
   instead of unconditional "forbidden".
5. **Disabled-reason:** show "needs ⟨n⟩ more points" (new i18n key) for unaffordable rewards.
6. **Accessibility:** `aria-label` on both search inputs (new keys), `aria-pressed` on status
   filters, `role="status"` on async feedback (item 1), arrow-key navigation in
   `HorizontalTabBar`.
7. **Touch targets:** raise 36px/40px controls in loyalty screens to ≥44px.
8. **Design-system alignment:** primary/secondary/danger actions in the hub, enrollment panel,
   and redeem flow move to `WakaButton` (layout otherwise unchanged).
9. **Duplicate reads:** hub passes its loaded `overview.publicCode` and `usage` down to
   `LoyaltyProgramCodePanel` / `LoyaltyEnrollmentRequestsPanel` as optional props, keeping each
   panel's fetch as a standalone fallback.
10. **Enrollment discoverability:** "Enroll new member" CTA in the member-list card that scrolls
    (anchor) to the enrollment panel.
11. **Translations:** every new string added in en, lg, sw; extend the loyalty i18n test to cover
    Phase 1 nav keys + all Phase 2 keys.
12. **Verification:** loyalty test batches, `tsc -b`, production build, acceptance criteria (§21).

## 17. Phase 2 Out of Scope (Explicitly NOT Phase 2)

- Phase 3+ items listed in §24 (member pagination, full activity ledger, per-section data
  isolation, translation backlog, public/member surface work, checkout work).
- Any permission/role/entitlement change (§8 findings are documented, not fixed).
- Any backend/RLS/migration change of any kind.
- Navigation/IA redesign; new sections; new routes; moving panels between sections.
- Redesigning the public card, join, program, or member dashboard surfaces.
- POS checkout loyalty UI changes.
- Toast/notification system introduction (inline feedback is standardized instead).
- Refactoring `LoyaltyHubPage` into multiple files (tempting, but scope discipline wins; may only
  extract when a batch requires it — see Batch risks).
- Cosmetic copy rewrites (P19) beyond what new states require.

---

## 18. Exact Files To Change

### Must change

| File | Current responsibility | Problem | Required change | Risk |
|---|---|---|---|---|
| `src/pages/LoyaltyHubPage.tsx` | All six sections; load/save/search; `CustomerList`/`CustomerDetail`/`HistoryList`/`MemberQrBlock` | P1–P12, P17 in one file | Skeleton + error/retry; live regions; redeem → `ConfirmationDialog`; renew/adjust feedback fixes; disabled-reason hint; `aria-label`/`aria-pressed`; touch targets; `WakaButton` on primary actions; enrollment CTA anchor; pass `publicCode`/`usage` props down | MEDIUM (large file; changes are localized per section) |
| `src/components/loyalty/LoyaltyEnrollmentPanel.tsx` | Search → consent → enroll → QR; scan/NFC | Unlabeled search input; raw buttons; loading text | `aria-label`, `WakaButton`, skeleton/label loading for options; live-region feedback | LOW |
| `src/components/loyalty/LoyaltyShell.tsx` | Shell composition | (indirect) | Only if tab-bar props change; otherwise untouched | LOW |
| `src/components/shared/HorizontalTabBar.tsx` | Tab list (single consumer: LoyaltyShell) | P15 | Arrow-key navigation + `tabIndex` roving per WAI-ARIA tabs | LOW (one consumer) |
| `src/components/loyalty/LoyaltyRewardsPanel.tsx` | Catalog CRUD | Plain empty state; raw buttons; touch targets | `EnterpriseEmptyState` for empty catalog; `WakaButton`; ≥44px targets | LOW |
| `src/components/loyalty/LoyaltyProgramCodePanel.tsx` | Permanent code + QR | P11 duplicate overview fetch | Optional `publicCode` prop from hub; keep fetch fallback; skeleton for its loading slot | LOW |
| `src/components/loyalty/LoyaltyEnrollmentRequestsPanel.tsx` | Join queue | P11 duplicate usage fetch; loading text | Optional `usage` prop with fetch fallback; skeleton loading | LOW |
| `src/lib/i18n.ts` | en + lg dictionaries | New strings needed | Add every Phase 2 key to en **and lg** | LOW |
| `src/lib/i18n/swOverrides.ts` | Swahili overrides | New strings needed | Add every Phase 2 key in sw | LOW |
| `src/lib/loyalty/loyaltyI18n.test.ts` | i18n assertions (5 checkout keys) | Doesn't cover Phase 1/2 keys | Assert en/lg/sw resolution for nav keys + every new Phase 2 key | LOW |

### Probably change

| File | Why |
|---|---|
| `src/lib/loyalty/loyaltyNav.ts` | Only if a tiny helper is needed for CTA/anchor logic (prefer keeping helpers local to the page) |
| `src/components/loyalty/LoyaltyCustomer360Panel.tsx` | Only for touch-target/`WakaButton` alignment of its actions — logic untouched |
| `src/components/loyalty/LoyaltySpendPromotionsPanel.tsx` | Same alignment pass as rewards (buttons/targets) |
| `src/lib/loyalty/loyaltyMerchant.ts` | Only if a typed error needs exposing for adjust feedback — **no RPC behavior change** |

### Do not touch (this phase)

Everything in §19, all of `supabase/`, all POS/checkout files, public/member pages, auth,
subscription, navigation IA files beyond the table above.

---

## 19. Exact Files To Protect

- All `supabase/migrations/*loyalty*` and every other migration; all `supabase/functions/**`
  (wallet service, public-card edges).
- `src/lib/loyalty/` accounting/behavior modules: `loyaltyMath.ts`, `loyaltyAward.ts`,
  engine/RPC wrappers' semantics (`loyaltyRewards.ts` redeem flow, `loyaltyClient.ts`,
  `loyaltyEnrollment.ts` QR helpers) — read-only reuse.
- SQL-integration test suites asserting invariants (45 `*.sql.integration.test.ts` files).
- `src/components/pos/*` (checkout panel, dock, `PosLoyaltyCustomerRow`),
  `src/hooks/useLoyaltyCheckoutPreview.ts`.
- Public/member surface: `PublicLoyalty*Page.tsx`, `src/pages/member/*`,
  `src/components/loyalty/public/*`, `WakaLoyaltyCard.tsx`.
- `src/lib/permissions.ts`, `RoleProtectedRoute.tsx`, `actorAuthorization.ts`,
  `subscriptionEntitlements.ts`.
- `src/App.tsx` routes (no route changes needed), `OfficeHubSectionBody.tsx` entry (keep).

---

## 20. Implementation Batches

### Batch 1 — Data states & recovery

- **Objective:** P1, P2, P8 (+ partial P17): skeleton loading, error with Retry, live regions.
- **Files:** `LoyaltyHubPage.tsx`, `LoyaltyRewardsPanel.tsx` (empty state),
  `LoyaltyEnrollmentRequestsPanel.tsx`, `LoyaltyProgramCodePanel.tsx`, new i18n keys.
- **UX result:** a network blip no longer bricks the hub (Retry re-runs both loads); every async
  region has a skeleton or labeled loading state; screen readers hear save/redeem/enroll results.
- **Dependencies:** `EnterpriseSkeleton`, `EnterpriseErrorState`, `loyaltyLoading`-style keys.
- **Risks:** LOW — presentation only; keep the existing `loadState` gate (no section restructure).
- **Acceptance:** kill the overview fetch (devtools/offline) → error card with working Retry;
  loading shows skeleton not text; `role="status"` present on save/redeem/enroll/adjust feedback;
  dark mode correct.

### Batch 2 — Action safety & honest feedback (defect fixes)

- **Objective:** P3, P4, P5, P6.
- **Files:** `LoyaltyHubPage.tsx` (redeem dialog, renew row, adjust block, redeem hints),
  i18n keys (dialog labels, "needs N more points", adjust validation message).
- **UX result:** redemption is confirmed with full context (cost + balance-after) via the
  enterprise dialog; renew and adjust failures are visible and correctly worded; invalid adjust
  input explains itself; unaffordable rewards explain why the button is disabled.
- **Dependencies:** `ConfirmationDialog`, `loyaltyErrorKey`, existing redeem state machine
  (pendingRedeem + key untouched).
- **Risks:** MEDIUM — redeem is balance-affecting. Mitigation: only the *presentation* of the
  confirm step moves; `confirmRedeem()`, `newRedemptionIdempotencyKey`, and all RPC arguments
  stay byte-identical; duplicate/insufficient/error states keep their current handling.
- **Acceptance:** confirm shows reward, points, balance-after; cancel aborts without an RPC
  call; success/duplicate/error paths unchanged; renew failure shows a mapped message and
  disables while busy; adjust invalid input shows inline validation; adjust RPC failure shows
  `loyaltyErrorKey(result.error)` (not blanket "forbidden"); ineligible reward shows the
  needs-points hint.

### Batch 3 — Design-system, accessibility & responsive alignment

- **Objective:** P7, P9, P10, P11, P12, P15.
- **Files:** `LoyaltyHubPage.tsx`, `LoyaltyEnrollmentPanel.tsx`, `LoyaltyRewardsPanel.tsx`,
  `LoyaltySpendPromotionsPanel.tsx`, `HorizontalTabBar.tsx`, panels receiving props,
  i18n keys (search labels, CTA label).
- **UX result:** labeled search boxes; announced filter toggles; 44px+ targets; buttons that
  look and behave like the rest of DKASU; no duplicate overview/usage calls on the cards tab; a
  one-tap path from the member list to enrollment; keyboard arrow navigation across tabs.
- **Dependencies:** `WakaButton`, `aria-pressed`, anchor element id on the enrollment panel.
- **Risks:** LOW–MEDIUM — `WakaButton` visual swap can shift paddings; verify each touched
  screen at 320px. Prop-down for panels must preserve standalone fetch fallback (test by
  rendering without props in type-check).
- **Acceptance:** axe-style manual checks (tab order, arrow keys, focus visible); every filter
  announces pressed state; network tab shows **one** overview + **one** usage fetch per hub
  mount; enrollment CTA scrolls and focuses the enrollment search; 320px pass with no clipped
  targets.

### Batch 4 — Translations, tests & validation

- **Objective:** i18n completeness for changed strings; regression safety; final verification.
- **Files:** `src/lib/i18n.ts`, `src/lib/i18n/swOverrides.ts`,
  `src/lib/loyalty/loyaltyI18n.test.ts`; any fixes surfaced by tests.
- **UX result:** every new string reads natively in en/lg/sw.
- **Risks:** LOW.
- **Acceptance:** i18n test covers Phase 1 nav keys + all Phase 2 keys across en/lg/sw; loyalty
  suites green; `tsc -b` clean; production build passes; §21 checked item by item.

Batch order is mandatory: 1 → 2 → 3 → 4 (states before actions, actions before polish, i18n/tests
last so they cover the final string set).

---

## 21. Acceptance Criteria

Phase 2 is complete only when every line is checked:

**States & recovery**
- [ ] Hub loading renders `EnterpriseSkeleton` (not plain text)
- [ ] Hub load failure renders `EnterpriseErrorState` with a Retry button; Retry re-runs
      overview + usage and can recover without a page refresh
- [ ] Member search, member history, QR block, program code, enrollment requests, rewards each
      show a defined loading state
- [ ] Member-search-empty and rewards-catalog-empty render `EnterpriseEmptyState`
- [ ] All async success/error messages are inside `role="status"` regions

**Action safety**
- [ ] Redeem confirm happens in `ConfirmationDialog` showing reward, cost, and balance-after
- [ ] Cancel closes with zero RPC calls; confirm preserves idempotency-key behavior
- [ ] Redeem success / duplicate / insufficient / limit / expired / membership-expired messages
      unchanged and still shown
- [ ] List-row membership Renew disables while busy and shows `loyaltyErrorKey`-mapped errors
- [ ] Adjust-points shows inline validation for invalid input (no silent no-op)
- [ ] Adjust-points failures display the mapped error, never a blanket "forbidden"
- [ ] Ineligible redeem buttons display a "needs N more points" hint

**Accessibility & responsive**
- [ ] Both search inputs have accessible names (`aria-label`)
- [ ] Status-filter buttons expose `aria-pressed`
- [ ] `HorizontalTabBar` supports Left/Right arrow navigation with visible focus
- [ ] All loyalty action/filter controls are ≥44px tall
- [ ] Verified at 320 / 375 / 768 / 1280 widths: no clipping, no horizontal page scroll,
      dialogs usable

**Design system & data**
- [ ] Primary/secondary/danger actions on touched screens use `WakaButton`
- [ ] One `loyalty_shop_overview` and one `shop_loyalty_usage` fetch per hub mount (panels reuse
      hub props; standalone fallback still type-checks)
- [ ] "Enroll new member" CTA scrolls/focuses the enrollment panel

**Translations**
- [ ] Every new key exists in en, lg, and sw; loyalty i18n test extended and green

**Preservation**
- [ ] Six-section IA, routes, legacy-id redirects, Office entry, and permission-aware tab hiding
      byte-for-byte behavior unchanged
- [ ] No permission change; rewards tab still hidden without `settings.shop`
- [ ] No migration/backend/RLS/accounting changes (git diff contains no `supabase/`)
- [ ] Dark mode verified on every touched screen; no hard-coded surfaces introduced

**Validation**
- [ ] Loyalty test suites green (see §22; pre-existing failures excluded and reported)
- [ ] `tsc -b` clean; production build passes
- [ ] Phase 3 not started

---

## 22. Testing Requirements

**Run after implementation (in order):**

1. Focused suites for touched code:
   - `npx vitest run src/lib/loyalty/loyaltyNav.test.ts src/lib/loyalty/loyaltyI18n.test.ts`
   - `npx vitest run src/lib/loyalty/loyaltyMerchant.test.ts src/lib/loyalty/loyaltyRewards.test.ts src/lib/loyalty/loyaltyEnrollment.test.ts`
2. Full loyalty unit batch: `npx vitest run src/lib/loyalty --no-file-parallelism`
   (**use `--no-file-parallelism`** — PGlite SQL-integration suites are resource-sensitive and
   drift into flakes when run with file parallelism).
3. Any test file touched by Batch 3 alignment (component tests if added).
4. `npm run build` (runs `tsc -b` + production vite build + SEO asset verify).
5. `npm run lint` on changed files if lint flags them.

**Baseline caveats (from this project's recorded test constraints):**
- Roughly **28 suites fail on a clean checkout** — a pre-existing, drifting baseline unrelated to
  this work. Do **not** chase them; to prove any failure is caused by Phase 2, use an
  **import-graph check** on the touched module — **not** a whole-file `git stash` (stash-based
  bisection was misleading here).
- Report pre-existing failures separately (§25); only regressions traceable to changed files are
  Phase 2's responsibility.

**Recommended new coverage (small, high-value):**
- Extend `loyaltyI18n.test.ts` key list: all 12 Phase 1 nav keys (`loyaltyTab*`,
  `loyaltySection*Sub`) + every Phase 2 key, asserted for en/lg/sw.
- If Batch 2 extracts a pure helper (e.g., "balance after confirm" formatting), unit-test it.
- No new SQL-integration tests: no backend behavior changes.

**Manual verification (required — no DOM test project exists in this repo):**
- Render authenticated hub via a faked session (localStorage + Playwright, per this project's
  established practice) to visually confirm skeleton/error/dialog/empty states in light + dark
  at 375px and 1280px.

---

## 23. Risks

| Risk | Level | Mitigation |
|---|---|---|
| Redeem presentation refactor alters idempotency/dedup behavior | HIGH | Move only the confirm *step* into the dialog; keep `pendingRedeem`, `newRedemptionIdempotencyKey()`, `confirmRedeem()` and RPC args untouched; existing redeem tests must stay green |
| Accidental backend/RLS touch | HIGH | §13/§19 protection list; PR check: `git diff --stat` contains no `supabase/` |
| Silent permission broadening | HIGH | No edits to `permissions.ts` / route gates; rewards-tab hiding preserved (existing nav test guards it) |
| Large single-file edits in `LoyaltyHubPage.tsx` cause regressions | MEDIUM | Batch-by-batch edits with typecheck after each batch; changes localized to named sections; no drive-by refactors |
| `WakaButton` restyle shifts layout unexpectedly | MEDIUM | Swap per-screen, visually verify at 320/1280 before moving on; keep ghost/secondary variants for dense rows |
| New i18n keys missing a language | MEDIUM | Batch 4 i18n test asserts all three languages for every new key |
| Duplicated-data props break standalone panel usage | LOW | Keep fetch fallback when prop is absent; type props as optional |
| Arrow-key change in shared `HorizontalTabBar` | LOW | Single consumer (LoyaltyShell); existing nav test + manual keyboard pass |
| Test baseline drifters blamed on Phase 2 | LOW | §22 protocol: import-graph check, separate reporting |

---

## 24. Later Phases (not now)

- **Member list pagination:** needs `loyalty_search_accounts` offset/cursor (backend migration).
- **Full activity ledger view:** needs a paged activity RPC (backend migration).
- **Per-section data isolation** (members usable when overview fails) — restructure of the hub
  load model (P18).
- **Translation backlog:** 305 sw-overrides + 8 lg-missing `loyaltyWalletMember*` keys + review
  of 168 lg keys identical to English — a dedicated translation pass, reviewed by a speaker.
- **Public/member surface polish** (public card dark-mode decision, member dashboard, join flow).
- **Checkout loyalty UX work** (protected area; separate phase with its own audit).
- **Panel decomposition** of `LoyaltyHubPage.tsx` into per-section modules (pure refactor).
- **Loyalty toast/notification pattern** if inline live-regions prove insufficient.
- **Permission model questions** (manager vs `user_can_manage_shop` headroom) — product decision,
  outside a UI phase.

---

## 25. Pre-existing / Unrelated Issues (observed, not fixed here)

- ~28 vitest suites fail on the current baseline (drifting; unrelated to Loyalty UI; see §22).
- 8 `loyaltyWalletMember*` keys missing from the lg dictionary (English fallback via `t()`).
- 305 loyalty keys missing sw overrides (English fallback).
- `loyalty_search_accounts` has no offset parameter (documented backend limitation).
- Server-side `recentActivity` cap of 10 rows (documented backend limitation).
- Public card view is light-branded under dark mode (documented as by design).
- `docs/waka-loyalty-prompts/docs/loyalty/STATUS.md` describes an older 10-phase build roadmap
  that predates this redesign — historical, not authoritative for Phase 2.
- `LoyaltyHubPage` size (1,675 lines) — maintainability concern deferred to Later Phases.

---

*End of audit. This document is the complete, self-contained source of truth for Loyalty
Phase 2. A later implementation session can execute Phase 2 from this file alone, without
re-auditing the repository.*
