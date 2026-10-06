# DKASU POS — Customer Loyalty Dashboard Audit

Audit date: 2026-10-05. Audit-only session: no source code, migrations, RLS, RPCs, wallet
functions, routes or configuration were modified; nothing was committed or pushed.

Scope: the end-customer Loyalty Dashboard served at **loyalty.dkasu.com** (and the legacy
`loyalty.waka.ug` alias), its supporting member data layer, and the merchant Phase 2 work is
explicitly out of scope (commit `85dc92c3`).

Evidence basis: full source inspection of the member surface, data layer, migrations, wallet
implementation and i18n architecture; a live fetch of `https://loyalty.dkasu.com` (served shell:
title `DKASU POS – Business Management & POS Software for Uganda`, brand `DKASU POS`, `Loading…`);
and the current repository at `4764f921`. Visual claims made in the review request were
cross-checked against the source that produces them (the described screenshots — WAKA title,
four summary tiles, single loyalty card, Account block — match `MemberHomePage.tsx` exactly).

---

## 1. Executive Summary

The customer dashboard is architecturally **sound and secure**: one auth.uid()-scoped
security-definer projection family, per-merchant point isolation enforced in both data and copy,
bearer tokens withheld from every member projection, server-side phone masking, and a
race-hardened realtime enrollment flow. Multi-merchant is already modelled correctly
(`loyalty_member_links` → per-shop `loyalty_accounts`), and a premium PVC-style digital card
component already exists with a safe derived Member ID and a decorative, non-credential CVC.

The gaps are product-surface gaps, not foundation gaps:

1. **Branding split-brain (P0)** — the live DKASU host renders `WAKA Loyalty` in the dashboard
   `<h1>`, card wordmark, SEO strings, fallbacks and welcome/register copy, while the shell,
   merchant i18n and SEO layer already say DKASU.
2. **Wallet button always says "Add to Google Wallet" (P0)** — the backend knows
   issued/synced state (`google_wallet_object_id`, `google_wallet_issued_at`,
   `google_wallet_synced_at`) but no member projection exposes it, so the UI cannot reflect
   reality. It must also never claim "installed" — the architecture cannot know that.
3. **The dashboard is English-only** — `MemberHomePage`, `MemberRegisterPage`, `WelcomePage`,
   `PublicLoyaltyCardPage` and `WakaLoyaltyCard` have **zero** `t()` wiring and `/member` has no
   language toggle, while login/join/program/code-entry are fully i18n'd in en/lg/sw.
4. **No premium card section on the dashboard** — `WakaLoyaltyCard` renders only on the public
   token page; the dashboard's "Digital card ready" line is a dead-end status (the projection
   deliberately withholds the tokens needed to render the card).
5. **Activity is a flat newest-first list** — no date ranges, merchant filter, type filter or
   date grouping; the RPC accepts only `p_limit ≤ 100` + a keyset cursor, so those filters are
   backend-dependent.
6. **Reward benefit invisible** — `benefitKind`/`benefitAmountUgx`/`benefitPercent` are fetched
   but never rendered; the customer sees cost but not what the reward is worth.

Priorities: P0 = branding + wallet-state honesty. P1 = dashboard i18n, card section, activity
center, reward value display, summary clarity, account placement, SEO title. P2 = performance
caching, points-expiry display, date localization, balance-after display, section navigation,
dark-mode polish of the public card view.

---

## 2. Current Architecture

### Routes (customer surface)

| Route | Component | Auth | Notes |
|---|---|---|---|
| `/member` | `MemberHomePage` | `ProtectedRoute` | Mounted as a **sibling** of the merchant branch — outside `BusinessProfileRequiredRoute`, `ActivationGateOutlet`, `PosDataProvider`, `OnboardingRouteGate`, `AppShell` (a member has no shop) |
| `/member/register` | `MemberRegisterPage` | public | Customer signup sibling of `/register` |
| `/login` | `LoyaltyLoginPage` when `isLoyaltySurface()` | — | Same route, two products; merchant login byte-for-byte unchanged elsewhere |
| `/c/:publicCardToken` (canonical), `/loyalty/:token` (legacy) | `PublicLoyaltyCardPage` | public | Bearer-token card share page |
| `/join/:enrollmentToken` | `PublicLoyaltyJoinPage` | public | Enrollment link |
| `/j/:programCode` | `PublicLoyaltyProgramPage` | public | Program-code QR target |
| anything on a loyalty host | `LoyaltySurfaceBoundary` | — | On `loyalty.waka.ug` **and** `loyalty.dkasu.com` (`LOYALTY_HOSTS`), merchant paths redirect to `/member` |

### Data model (traced from migrations)

- **`loyalty_members`** (`20260928100000`): `auth_user_id` unique, `display_name`,
  `phone_e164` (`+256…` CHECK), `phone_verified_at`, `email` (lowercase CHECK), `status`
  (active/suspended/closed).
- **`loyalty_member_links`** (same migration): `member_id` + `account_id` + `shop_id` with a
  **composite FK** `(account_id, shop_id) → loyalty_accounts(id, shop_id)`, unique
  `(member_id, account_id)`, `status` active/revoked with shape CHECK. **Revoked from `anon`
  and `authenticated`** — no browser read path exists.
- **`loyalty_accounts`** (`20260918024500` + later): per-shop account, cached counters
  (`balance_points`, `lifetime_earned_points`, `lifetime_redeemed_points`), **`qr_token`**
  (opaque bearer, unique), `membership_expires_at`, `enrolled_at`, `status`
  (active/disabled + lifecycle extensions), `public_card_token` (bearer URL), and wallet
  columns `google_wallet_object_id`, `google_wallet_issued_at`, `google_wallet_synced_at`,
  `google_wallet_sync_balance` (`20260923120000`).
- **`loyalty_transactions`** (ledger, immutable): `kind`
  (`earned|redeemed|reversed|expired|adjusted|promotional`), `cause`
  (`sale|return|void|redemption|expiration|manual_adjustment|promotion|enrollment`), signed
  `points`, `balance_after`, `source_sale_id`/`source_return_id`.
- **Card/member identifier:** there is **no `card_number`/`member_number` column** anywhere.
  The display-safe identifier is **derived server-side**: `deriveLoyaltyMemberNumber(accountId)`
  in `supabase/functions/_shared/loyaltyWallet/publicCardLookup.ts` produces `member_number`
  (e.g. `26D4 33F0 2BED 4ABE`) and `member_cvc` (3 digits) from a **one-way hash** so the
  account UUID never leaves the server. The CVC is documented as decorative-only.

### Member data layer (`src/lib/memberDashboard.ts`)

| Function | RPC | Parameters | Auth model |
|---|---|---|---|
| `fetchMemberDashboard` | `loyalty_member_dashboard` | **none** | `auth.uid()` → member → links → accounts |
| `fetchMemberActivity` | `loyalty_member_activity` | `p_limit` (default 20, max 100), `p_before`, `p_before_id` (keyset) | same |
| `fetchMemberRewards` | `loyalty_member_rewards` | `p_limit` (default 100, `truncated` flag) | same |
| `fetchMemberPromotions` | `loyalty_member_promotions` | none | same |
| `registerLoyaltyMember` | `loyalty_member_register` | name, phone | idempotent; never creates a tenancy |
| `startMemberClaim` | `loyalty_member_claim_start` | shop, card token | never auto-links (proof = card token, never phone) |
| (wallet) | `loyalty_member_wallet_account` | `p_shop_id` | authority chain; lifecycle verdicts only |
| (status) | `useMemberEnrollmentStatus` | — | realtime + polling fallback; none/pending/approved/rejected |

The browser never touches `loyalty_accounts` or `loyalty_member_links` (both revoked from
client roles). Dashboard projection fields per account: shop `{id,name,business_type,district}`,
account `{status, balance_points, lifetime_earned_points, lifetime_redempleted_points,
membership_expires_at, enrolled_at}`, card `{has_public_card}` — **presence only**; never
`qr_token`, never `public_card_token`, no wallet fields, no member number.

### Rendering

`MemberHomePage` (1,028 lines) = header + Account block + state machine
(loading skeleton / error+retry / not-a-member code entry / pending approval / rejected) →
`MemberDashboardView` (identity → summary → merchant cards → activity → promotions → rewards).
Mobile-first: `max-w-md`, `px-5`, theme tokens with `dark:` variants.

---

## 3. Current Customer Journey

1. **Acquire**: merchant QR → `/j/<programCode>` (public program page, i18n'd) or share link →
   `/join/<token>`; or `/login` on the loyalty host (email/password + Google, language toggle).
2. **Identity**: `/member/register` creates the `loyalty_members` row only (name/phone) — the
   dashboard itself never creates members (Phase 2C rule, enforced in code comments and flow).
3. **Link**: code entry (`LoyaltyCodeEntryForm`) → join → `loyalty_member_claim_requests` /
   enrollment request → **merchant approves** → active `loyalty_member_links` row.
4. **Waiting states**: dashboard shows "Waiting for merchant approval" with realtime updates
   ("you do not need to refresh"), or "Request not approved" + code re-entry. Correct and
   race-hardened (`useMemberEnrollmentStatus` documents read/subscribe races explicitly).
5. **Steady state**: `/member` — identity, aggregate summary, per-merchant cards, cross-merchant
   activity, promotions, rewards, per-merchant wallet buttons, collapsible Account with sign-out.
6. **Share**: public `/c/<token>` shows the premium `WakaLoyaltyCard` + QR to anyone holding the
   URL (bearer by design).

Journey gaps: no path from the dashboard to view/open its own digital card ("Digital card
ready" is informational only); no language/theme control anywhere on `/member`.

---

## 4. Current Dashboard IA

Observed order on one long scroll:

1. Logo + **`WAKA Loyalty` h1** + "Your member account"
2. **ACCOUNT** (collapsible; name / email / Google / Sign out) — second block on the page
3. Identity card (member name, phone masked, status pill, "Member since · N linked merchants")
4. Summary: TOTAL POINTS · MERCHANTS · LIFETIME EARNED · LIFETIME REDEEMED (+ disclaimer)
5. "Your loyalty card" (1 merchant, prominent) or "Your merchants" (N) — stat cards, not card faces
6. ACTIVITY (list, cursor "Show earlier activity")
7. PROMOTIONS (conditional)
8. REWARDS (+ "redeemed by the shop at checkout" note)
9. Empty variants: code entry / pending / rejected / error-with-retry

Evaluation against the intended structure (Account / overview / memberships / cards / activity /
rewards / wallet):

- **Account**: present but **too prominent** (top slot) relative to loyalty content.
- **Overview + memberships**: merged into identity + summary + merchant cards — clear at 1–2
  merchants; untested-feeling at 5+ (flat stack, no grouping or filter).
- **Digital loyalty cards**: **missing as cards** — merchant stat cards only; the premium card
  component exists but lives only on the public token page.
- **Activity**: present; no grouping, no filters, no balance-after.
- **Rewards**: present and honest (server-computed state, merchant-owned); benefit value not shown.
- **Wallet**: per-merchant buttons; state wrong (always "Add").
- Single long scroll is acceptable at this width (`max-w-md`) but has no section navigation;
  Account should move below loyalty content or into a footer-level disclosure.

---

## 5. Branding Audit

Customer-visible strings containing WAKA / waka.ug (all confirmed in source):

| Location | String |
|---|---|
| `MemberHomePage` h1 (863) | `WAKA Loyalty` |
| `MemberHomePage` fallbacks (425, 534, 545) | `WAKA merchant`, `WAKA member`, `WAKA Loyalty member` |
| `MemberHomePage` empty/rejected copy (560, 958, 1005) | `Enter a WAKA Loyalty code…`, `Join WAKA Loyalty`, `…another WAKA Loyalty code` |
| `MemberRegisterPage` (47) | `Join WAKA Loyalty` |
| `WelcomePage` (21, 38, 46) | `Welcome to WAKA`, `Run WAKA POS…`, `Join WAKA Loyalty` |
| `PublicLoyaltyCardPage` SEO (135–136) + footer (185) | `WAKA Loyalty`, `Your WAKA loyalty card`, `Powered by WAKA` |
| `PublicLoyaltyJoinPage` (219) | `WAKA Loyalty` |
| `PublicLoyaltyProgramPage` (348, 481) | `WAKA shops match your loyalty cards…`, `WAKA Loyalty` |
| `WakaLoyaltyCard` wordmark (133) + tagline + `w-icon-128.png` mark | `WAKA Loyalty`, `Shop · Earn · Redeem` |
| `PublicLoyaltyCardView` (136) | `WAKA Loyalty` |
| Comments/hosts | `loyalty.waka.ug` (legacy, redirecting) vs `loyalty.dkasu.com` |

What is **already DKASU**: the live document title and shell (`DKASU POS`), the merchant i18n
dictionary (`loyaltyErrNotEnabled` → "DKASU Loyalty…"), the SEO layer
(`seoRoutes.ts`: `noIndexSeoTitle` → `DKASU Loyalty`, canonical → `loyalty.dkasu.com`), the
dual-host product detection (`DKASU_LOYALTY_PRODUCT_HOST` + legacy alias), and the DKASU logo
shown in the screenshots.

Classification:

- **Must become DKASU (customer-visible copy/branding):** every row in the table above —
  h1, fallbacks, code-entry copy, welcome/register, SEO title/description, "Powered by",
  card wordmark.
- **Must NOT be touched (internal/compatibility):** RPC/table/function names, `waka-skeleton`
  CSS classes, persisted keys (`waka.ui.language`, `waka-pos-local-session`), asset paths that
  other systems import, historical data, the legacy host constant (redirect/allowlist per the
  DKASU migration rule — never global-replace identifiers).
- **Asset note:** the card/watermark uses `brand/w-icon-128.png` — verify whether the DKASU
  logo asset should replace the W mark on the card; that is a design decision, not a string fix.
- **Live shell title** is the generic POS title (`DKASU POS – Business Management…`), not a
  Loyalty-specific one — minor SEO/UX follow-up (P2).

---

## 6. Multi-Merchant Audit

**Model (correct):** one `loyalty_members` row per person; N `loyalty_member_links`; one
`loyalty_accounts` per (shop, customer). Composite FK makes cross-shop account linking
structurally impossible. Point isolation is enforced in the ledger (per-account rows) and
repeated in UI copy.

**Current experience:**
- Dashboard: summary aggregates **active** accounts only, with an explicit disclaimer
  ("Points are held by each merchant separately — they are never combined into one balance,
  and they are redeemed where you earned them") — the accounting rule the review demands is
  already stated in code.
- Each `MerchantCard` repeats its own balance/lifetime/expiry next to its name; merchant name
  shown on activity rows, reward cards and promotions **only when linked to >1 merchant**
  (`showMerchant={counts.linkedAccounts > 1}`) — correct de-cluttering.
- Activity/rewards/promotions RPCs return cross-merchant data with per-row `shopName` — no
  merchant filter exists (see §9/§12).
- Single-merchant special case: card is "prominent" (centered, larger balance) and heading says
  "Your loyalty card" — good.

**Verdict:** ONE account, per-merchant isolation, one scrolling dashboard — matches the desired
conceptual model. The forced "separate loyalty systems" feeling does **not** exist in the
architecture; it only partially exists visually because the dashboard shows stat cards instead
of distinct card artifacts per merchant (§7).

---

## 7. Loyalty Card Audit

**A premium digital card already exists**: `WakaLoyaltyCard` ("physical/PVC presentation", 1.586:1
aspect, container-query sizing from 320px up, no card-network branding, documented as a loyalty
card not a payment instrument) with exactly the intended hierarchy:

```
[W mark] WAKA Loyalty / Shop · Earn · Redeem
ISSUED BY            |  QR (real payload, white quiet zone, aria-labelled)
<merchant name>
MEMBER ID
<derived number>
MEMBER        VALID THRU   CVC
<name>        MM/YY        <3 decorative digits>
POINTS                            program name / W mark
<balance>
```

**Facts:**
- Member ID = `deriveLoyaltyMemberNumber` (one-way hash) — exists, display-safe, no new
  identifier needed.
- CVC = derived 3 digits, explicitly decorative (`title="Membership card reference only — not a
  security code"`), never phone digits — safe as specified.
- QR = real `DKASU-LOYALTY:<qr_token>` payload.
- **Rendered only by `PublicLoyaltyCardView` (public `/c/:token`)**. The member dashboard never
  renders it: `MemberLinkedAccount` carries only `has_public_card`, and the projection withholds
  `qr_token`/`public_card_token` (correct — bearer credentials) and does not derive
  `member_number`/`member_cvc`.
- "Digital card ready" on the dashboard therefore has **no tap-through** — a dead-end status.

**Dashboard card section — the gap:** the desired "YOUR LOYALTY CARDS / [premium card per
merchant]" is achievable with the existing component, but requires a member-scoped projection
decision (backend-dependent, §21): expose derived `member_number`/`member_cvc` (non-credential,
same derivation as the public path) and decide how the QR reaches the member's own device
(options analyzed in §7 of the recommendations — never the public URL token, never phone digits).

Multi-card layout recommendation (evaluated, not implemented): for 1–3 merchants, stacked full
premium cards (the component already scales); for 4+, a horizontal snap-carousel of card
*fronts* with an "All cards" expansion — matching the existing single-column mobile wallet feel
without a desktop-style grid. Merchant filter chips are unnecessary until merchants exceed ~6.

---

## 8. Google Wallet Audit

**What the backend actually knows** (`loyalty_accounts`):
- `google_wallet_object_id` — deterministic object (`{issuerId}.acct_<account_uuid>`)
- `google_wallet_issued_at` — pass issued
- `google_wallet_synced_at` + `google_wallet_sync_balance` — last balance sync + value
- `loyalty_wallet_sync_outbox` — pending/failed sync queue
- Lifecycle verdicts via `loyalty_member_wallet_account`: `account_revoked`,
  `account_inactive`, `membership_expired` (same vocabulary as the merchant path)

**What it cannot know:** whether the pass was **saved/installed** on the device, **opened**,
or still present — no Google save-state callback exists in this architecture. Any UI claiming
"installed/saved" would be false.

**What the member UI does today** (`MemberGoogleWalletButton`):
1. Probe `fetchGoogleWalletConfigured()` — an **uncached edge GET** per button mount
   (N merchants → N calls per dashboard load);
2. Button **always** reads `loyaltyWalletMemberAdd` = "Add to Google Wallet" (translated in
   en/lg/sw ✓), busy → "Creating your card…", success → "Opening Google Wallet…", errors →
   `memberWalletErrorKey` mapped ✓, `role="status"`/`role="alert"` ✓;
3. `issueMemberGoogleWalletPass(shopId)` → edge `loyalty-wallet-pass` → fresh `saveUrl` →
   opened `noopener,noreferrer`.

The "same object every time" guarantee (same issuer/class/object id as the merchant's issue)
means re-clicking is *safe* but the **label is dishonest after the first issue** — the user is
never told the card exists, and the dashboard does not read any wallet state.

**Recommended state model (only what the architecture supports):**

| State | Backend signal | Label |
|---|---|---|
| Not configured | probe `configured=false` | (button hidden — current behavior ✓) |
| Not issued | `google_wallet_object_id IS NULL` | **Add to Google Wallet** |
| Issued | `object_id` + `issued_at` set | **Open in Google Wallet** (+ "Added ⟨date⟩") |
| Sync stale | `sync_balance <> balance_points` | **Update wallet card** |
| Unusable | lifecycle verdict (revoked/inactive/expired) | button hidden (current ✓) or "Wallet card unavailable" |
| Installed/on-device | **unknown — never shown** | — |

Requires: member dashboard projection to include a small `wallet` object (backend-dependent,
projection-only — no schema change). The saveUrl flow itself is unchanged.

---

## 9. Activity / History Audit

**Source:** `loyalty_member_activity` — newest-first, security-definer, `auth.uid()` only.

**Parameters (whole truth):** `p_limit` (≤100), `p_before` (timestamptz), `p_before_id`
(keyset tie-breaker). **No date range, no merchant filter, no type filter parameters exist.**

**Per row:** `kind`, `cause`, `points`, `balance_after`, `created_at`, `shop.id/name`,
`sale_total_ugx`, `reward_name`, `reward_points_required`.

**UI today:** flat list; signed points; merchant name only when multi-linked; date via
`toLocaleDateString("en-GB")` (not localized to app language); "Show earlier activity" cursor
pagination (20/page) with busy state; loading skeleton; error + empty copy ✓.
`balance_after` is fetched but **never displayed**.

**Proposed ACTIVITY center ([Today][Week][Month][Custom] + merchant + type filters):**

| Capability | Supported today? |
|---|---|
| Today/Week/Month/Custom range | **No** — would require RPC parameters (backend). Client-side filtering of the fetched cursor page would silently hide older data — misleading; do not fake it. |
| Start/End dates | No (backend) |
| Merchant filter | Data has `shopId` — client-side filtering of loaded pages is possible but only honest with a full fetch; server-side preferred (backend) |
| Type filter | `kind`/`cause` present — same caveat |
| Pagination | **Yes** — keyset cursor already implemented ✓ |
| Loading/empty/error | **Yes** ✓ |
| Date grouping (Today/Yesterday/…) | Frontend-only over loaded rows, but truthful only if labeled as grouping the loaded window |

**Conclusion:** a truthful Activity Center needs a modest RPC extension (date bounds + optional
`p_shop_id` + optional `p_kind`, reusing the cursor) — backend-dependent; the entire UI layer
can then be frontend-only. **Do not build date filters client-side over a cursor page.**

## 10. Activity Semantics Audit

`activityLabel()` already distinguishes, in member-facing words:

| kind/cause | Label |
|---|---|
| `earned` + sale total | `Purchase — UGX 10,000` |
| `earned` (other) | `Points earned` |
| `redeemed` + reward | `Reward redeemed — <name>` |
| `adjusted` + `redemption_reversal` | `Redemption reversed — <name>` / `…points returned` |
| `adjusted` (other) | `Adjustment` |
| `reversed` + `void` | `Sale voided — points reversed` |
| `reversed` (return) | `Return — points reversed` |
| `expired` | `Points expired` |
| `promotional` | `Promotional points` |
| fallback | `Points movement` |

Why/when/which-merchant/how-many are all answerable per row (label + date + shopName + signed
points). Gaps: the labels are **hardcoded English** (not translated); `balance_after` (the
resulting balance) is not shown; there is no grouping by date. **Merchants are never merged
into one number in the list** — each row keeps its shop — so no ledger ambiguity exists today.

## 11. Points / Ledger Presentation Audit

- Summary tiles: `Total points` = sum of **active** accounts' balances; `Lifetime earned` /
  `Lifetime redeemed` = sums over active accounts (disclaimer: "Across your active merchants").
- The disclaimer explicitly states balances are held separately and redeemed where earned.
- **Risk:** the naked "TOTAL POINTS 630" heading can still be read as spendable anywhere by a
  customer skimming; the four-tile grid repeats the aggregate shape of a bank balance.
- **Recommendation (least confusing model):** keep the aggregate **but** (a) retitle to
  "Points across merchants" / label "Active merchants only", (b) render a compact per-merchant
  breakdown row directly under it (A 180 · B 400 · C 50), and (c) never show the aggregate
  without the per-merchant cards below (already true). Per-merchant cards remain the
  authoritative display. No pooling language anywhere (none exists today ✓).
- **Missing:** points **expiry** is not surfaced to the member at all (the backend has points
  expiry via lot allocation; the projection exposes none of it) — customers cannot see when
  points will lapse (P2, backend-dependent).

## 12. Rewards Audit

Per reward the customer sees: name, description, **cost**, merchant (when multi), server state
pill (`Ready to redeem` / `N more points needed` (+ progress bar) / `Already redeemed the
maximum` / `Expired ⟨date⟩` / `No longer offered`), `Just for you`, `Redeemed ×N`,
availability window, personal-grant window, redemptions remaining, and the honest instruction
"Redeemed by the shop at checkout". Merchant ownership via `shopName` when multi-linked —
a Merchant A reward can never appear redeemable at Merchant B (redemption is merchant-driven;
there is no member redeem action at all) ✓.

**Gaps:**
- **Benefit value invisible:** `benefitKind`/`benefitAmountUgx`/`benefitPercent` are fetched
  (`MemberReward`) but `RewardCard` never renders them — a "10% off" or "UGX 5,000 off" reward
  reads only as a point cost (P1, frontend-only).
- Flat list, no merchant grouping/filter (acceptable ≤3 merchants; P2 for grouping).
- No monetary value shown by design (schema has none) ✓ correct.

## 13. Membership Expiry Audit

- Per-merchant `membership_expires_at` shown on each card: "Membership expires ⟨date⟩" or
  amber "Membership expired ⟨date⟩"; absent = no expiry (correctly not shown as expired).
- Reward expiry shown per reward ("Available until…"); concepts are **not mixed** ✓.
- Status pills (`active`/`suspended`/…) with tones ✓.
- **Missing:** renewal guidance (renewal is merchant-driven — "ask the shop to renew" appears
  nowhere), and membership status is not tied to wallet usability messaging (the button is
  hidden when unusable, with no explanation).

## 14. Mobile UX Audit

- Layout: `mx-auto max-w-md px-5 py-10` — genuinely mobile-first (a wallet, not a squeezed
  admin page) ✓; screenshots' viewport matches.
- Tap targets: account toggle 52px, primary buttons ≥44px, activity "Show earlier" 44px,
  sign-out 44px ✓; some pill/text at `text-[11px]` — legible but dense (contrast should be
  spot-checked at 320px).
- No horizontal scroll constructs; long merchant/reward names use `break-words`/`truncate`
  with `min-w-0` ✓.
- Cards stack vertically — fine to ~3 merchants; at 5+ the page becomes long (see §5 layout
  recommendation).
- No sticky elements; scrolling is native. No calendar exists yet (activity filters pending §9).
- 320/375/390/414: structure is fluid (percentage/container-query card), expected OK; the
  premium card component is explicitly container-query scaled from 320px ✓.

## 15. Accessibility Audit

- Headings: single `h1` (title) + `h2` per section (merchants/activity/promotions/rewards) ✓.
- Account toggle: native `<button>` + `aria-expanded` ✓; expandable regions are DOM-toggled ✓.
- Status: wallet success `role="status"`, errors `role="alert"` ✓; skeletons `aria-busy` +
  `sr-only` "Loading your account…" ✓.
- QR image: meaningful `alt` ("show this at the shop to earn and redeem points") ✓; decorative
  mark `aria-hidden` ✓; card CVC tooltip states it is not a security code ✓.
- Progress bars `aria-hidden` but adjacent text carries the numbers ✓ (acceptable; a
  `role="progressbar"` with values would be better — P2).
- Focus states rely on theme `focus-visible` tokens; buttons are native.
- Gaps: language/theme controls absent on `/member` (a11y for language users); very small
  `text-[11px]` labels; activity rows have no heading/group structure for screen-reader date
  navigation (ties to §9 grouping).

## 16. Translation Audit

| Surface | i18n status |
|---|---|
| `LoyaltyLoginPage` | ✓ `t()` ×19 (en/lg/sw) |
| `PublicLoyaltyJoinPage` | ✓ ×22 |
| `PublicLoyaltyProgramPage` | ✓ ×40 |
| `LoyaltyCodeEntryForm` | ✓ ×6 |
| `MemberGoogleWalletButton` | ✓ (via `memberWalletErrorKey`) |
| **`MemberHomePage`** | ✗ **0** — all copy hardcoded English, incl. `activityLabel()` prose, `rewardStatusLabel()`, `BUSINESS_TYPE_LABELS`, section text, summary labels |
| **`MemberRegisterPage` / `WelcomePage`** | ✗ 0 |
| **`PublicLoyaltyCardPage` / `WakaLoyaltyCard` / `PublicLoyaltyCardView`** | ✗ 0 |
| Language control | AuthLayout has toggle ✓; **`/member` has none** (no `setLang` prop at all) |
| Dates | `toLocaleDateString("en-GB")`, `toLocaleString()` — not tied to app language |
| Raw keys / raw RPC codes leaking | None found in member surfaces (errors mapped through `memberWalletErrorKey`; dashboard errors use prose) |
| Placeholders | N/A (no i18n in dashboard yet) |

**Verdict:** the dashboard must be migrated to the existing `t()`/`tTemplate` architecture
(en/lg/sw dictionaries + `swOverrides`/`lgOverrides` layering), plus a language toggle on
`/member` (same control as AuthLayout). No new translation mechanism.

## 17. Security / Data-Isolation Audit

Traced properties (all verified in source):

1. **Cross-member isolation:** every read is a `security definer` projection with **no
   identity parameters** — resolved from `auth.uid()` alone. There is no member id to forge.
2. **Cross-merchant isolation:** accounts come only from the caller's own active
   `loyalty_member_links`; composite FK binds account↔shop.
3. **No browser path to raw tables:** `loyalty_member_links` revoked from `anon` +
   `authenticated`; `loyalty_accounts` not readable (per data-layer contract).
4. **Bearer tokens:** `qr_token` / `public_card_token` never appear in any member projection;
   the wallet RPC explicitly refuses them; the dashboard cannot deep-link a public card.
5. **Identity exposure:** phone masked **server-side** (`+256** *** xxx`); email returned but
   rendered only inside the member's own Account panel; member name shown to self.
6. **Public card page:** token-in-URL = bearer by design (shareable card view); rate-limited
   edge path; acceptable, documented.
7. **CVC/Member ID:** one-way hash derivation; decorative; **phone digits are never used as a
   credential** ✓ (and a support-export test asserts `card_number|cvv` never leak).
8. **Wallet authority:** `loyalty_member_wallet_account` takes a shop, not an account; a
   non-linked shop answers `not_found` — indistinguishable from a non-existent shop (no probe).
9. **Customer A → Customer B:** structurally impossible via the projection family; reward,
   activity, promotion and dashboard reads are all member-scoped.
10. **Merchant private data:** members receive shop name/type/district only — no merchant
    internals (customers, sales beyond their own `sale_total_ugx`, staff).

**No P0/P1 security findings.** One design point to decide (not a defect): exposing `qr_token`
to the *owning member's* dashboard (so they can render their own card QR) is a deliberate
relaxation of today's rule — see §21 card options; it does not leak *other* members' data, but
it does put a scanning credential into the browser. Alternatives in §21.

## 18. Performance Audit

- **Mount fan-out:** 4 parallel RPCs (dashboard, activity, rewards, promotions) + enrollment
  status read + realtime subscribe + **N × `fetchGoogleWalletConfigured()` edge GETs** (one per
  merchant card; **uncached**). The wallet-config probe is the clear waste (P2, frontend-only:
  memoize/share one probe per mount).
- **Refetch discipline:** good — dashboard re-reads only on `pending→approved`; no polling
  loops; activity pages appended via cursor (20 rows); promotions/rewards single-shot.
- **Caps:** activity ≤100/page-call (cursor unbounded overall ✓); rewards `limit=100` with a
  `truncated` flag that the UI **does not surface** (a member with >100 rewards silently sees a
  cut list — P2).
- **Multi-merchant:** everything scales linearly with links; no N+1 (projections return joins
  server-side). The main multi-merchant cost is the wallet-config probes above.
- No image-heavy assets on the dashboard itself (logo only).

## 19. Specific UX Problems (numbered)

| # | Problem | Evidence | Priority |
|---|---|---|---|
| U1 | `WAKA Loyalty` h1 + WAKA fallbacks/copy on DKASU host | `MemberHomePage.tsx:863,425,534,545,560,958,1005` etc. | **P0** |
| U2 | Wallet button always "Add to Google Wallet" after issuance | `MemberGoogleWalletButton.tsx` idle label; no wallet state in projection | **P0** |
| U3 | Dashboard/Register/Welcome/PublicCard/Card are English-only; no language toggle on `/member` | 0 `t()` calls; no `setLang` prop | **P1** |
| U4 | Premium card exists but is unreachable from the dashboard; "Digital card ready" is a dead end | `WakaLoyaltyCard` used only by `PublicLoyaltyCardView`; projection returns `has_public_card` only | **P1** |
| U5 | Activity: no date/merchant/type filters, no date grouping; `balance_after` unused; dates fixed to en-GB | RPC params; `MemberHomePage` list | **P1** |
| U6 | Reward benefit value never displayed | `MemberReward.benefit*` unused in `RewardCard` | **P1** |
| U7 | "TOTAL POINTS" aggregate may read as pooled spendable balance | Summary tiles + disclaimer (mitigation exists) | **P1** |
| U8 | Account block occupies the slot above loyalty content | renders before `MemberDashboardView` | **P1** |
| U9 | SEO/page title "WAKA Loyalty"/"Your WAKA loyalty card"/"Powered by WAKA" | `PublicLoyaltyCardPage.tsx:135-136,185` | **P1** |
| U10 | Wallet-config probe uncached (N edge calls per load) | `fetchGoogleWalletConfigured` no cache | **P2** |
| U11 | Points expiry invisible to members | no field in projection/type | **P2** |
| U12 | `rewards.truncated` not surfaced | `MemberRewardsPage.truncated` unused | **P2** |
| U13 | No renewal guidance on expired membership | card shows expiry only | **P2** |
| U14 | No section navigation on a long single scroll (5+ merchants) | flat `flex-col` view | **P2** |
| U15 | Live shell serves generic POS `<title>` on loyalty host | live fetch | **P2** |
| U16 | Stale SEO tests expect `WAKA Loyalty`/`waka.ug` (source is DKASU) | `loyaltyPublicCard.*.test.ts` failures (pre-existing, documented in Phase 2) | **P2** |
| U17 | `PublicLoyaltyCardView` light-only under dark preference | raw slate/white palette | **P2** |
| U18 | Progress bars lack `role="progressbar"` | promotion/reward bars `aria-hidden` | **P2** |

## 20. Recommended Future IA

Keep **ONE scrolling dashboard** (the wallet feel) with anchored section chips for jump
navigation when merchants ≥3 — not a tabbed SPA split (tabs hide the multi-merchant story):

```
[DKASU logo]  DKASU Loyalty            ← rebranded h1
              Your member account      (+ language + theme toggles)

MEMBERSHIPS   (identity summary folded here or kept as slim strip)
  Merchant A — 180 pts · exp 30 Oct 2026 · Active     [compact row-card]
  Merchant B — 420 pts · exp 15 Nov 2026 · Active

YOUR LOYALTY CARDS
  [premium WakaLoyaltyCard per merchant; snap-carousel when ≥4]

YOUR ACTIVITY  [Today][Week][Month][Custom] [All merchants ▾] …grouped list…

YOUR REWARDS   grouped by merchant (≤3) / tagged list (≥4)

PROMOTIONS     (unchanged)

ACCOUNT        (moved to the bottom; still collapsible)
```

Summary tiles: retitle + per-merchant breakdown row (§11). Empty/pending/rejected states stay
exactly as they are (they are good).

## 21. Recommended Future Dashboard Layout (sections of §23 evaluated)

The proposed future dashboard is **sound and mostly already built**. Evaluation notes:
- "Welcome / customer identity" — exists (identity card); keep slim.
- "YOUR MEMBERSHIPS" — exists as merchant cards; rename + compact for multi.
- "YOUR LOYALTY CARDS" — the real addition; requires member card projection (options below).
- "YOUR ACTIVITY" — filters require the RPC extension (§9).
- "YOUR REWARDS" — exists; add benefit values + merchant grouping.
- "GOOGLE WALLET" — states per §8 table.
- Do **not** split into separate merchant dashboards — current architecture is right.

## 22. Recommended Loyalty Card Specification

Fields (all already implemented in `WakaLoyaltyCard` — no new identifier invented):

| Field | Source | Status |
|---|---|---|
| DKASU logo/wordmark | replace `WAKA Loyalty` wordmark (asset decision) | branding change |
| ISSUED BY | `shops.name` via dashboard projection ✓ | available |
| MEMBER | member `display_name` ✓ | available |
| CARD/MEMBER ID | `deriveLoyaltyMemberNumber` (hash) | **backend**: derive in member projection |
| VALID THRU | `membership_expires_at` → MM/YY ✓ | available |
| POINTS | per-account `balance_points` ✓ | available |
| CVC-style | derived 3 digits, decorative, tooltip "not a security code" | **backend**: derive alongside member number |
| QR | `<qr_token>` payload | **backend decision** (see below) |

**QR options for the member's own dashboard (decide before implementation):**
1. **Member projection returns `qr_token` for the member's own accounts** — simplest; the
   member is the legitimate holder of their own scanning credential (showing your card is the
   product), but it does place a bearer value in the browser. Acceptable if the projection stays
   auth.uid()-scoped and the token is only ever the member's own.
2. **Server-rendered QR image** (edge/RPC returns a data URL) — token never reaches browser JS;
   slightly heavier.
3. **No QR on dashboard; "Show card" opens a short-lived signed view** — most conservative.
No option uses phone digits or the public-card URL token. Recommendation: option 1 or 2 —
both frontend-visible, backend-projection work; option 3 if the security review insists on
zero long-lived bearer material in the member session.

## 23. Recommended Activity Center Specification

- UI: segmented `[Today][Week][Month][Custom]` + merchant `<select>` + type chips; Custom reveals
  From/To date inputs; list grouped by day headings; each row keeps merchant + signed points +
  (new) balance-after.
- Backend (one RPC extension, no schema change): add `p_from`, `p_to`, `p_shop_id`, `p_kind`
  (nullable) to `loyalty_member_activity`, keep the keyset cursor, keep `auth.uid()` scoping.
- Frontend-only fallback if the RPC cannot change soon: keep the current list + client-side
  grouping of the loaded window, clearly labeled — **no fake date filtering**.
- Everything else (loading/empty/error/pagination) already exists.

## 24. Recommended Google Wallet States

Exactly the §8 table: Not issued → **Add to Google Wallet**; Issued → **Open in Google
Wallet** (+ added date); Stale sync → **Update wallet card**; Unusable → hidden/unavailable;
**never** "Installed". Requires: wallet object fields in the member dashboard projection
(backend, projection-only). The shared deterministic object id already guarantees idempotent
re-add; the fresh `saveUrl` flow is unchanged.

## 25. P0 / P1 / P2 Priority Matrix

**P0 (correctness of what the customer sees)**
- P0-1 Branding: all customer-visible WAKA strings/assets → DKASU (§5 table; keep internal
  identifiers).
- P0-2 Wallet button honesty: implement issue-state labels per §8 (needs wallet fields in the
  member projection).

**P1 (core product experience)**
- P1-1 Dashboard i18n (en/lg/sw) + language/theme toggle on `/member`.
- P1-2 Premium card section on the dashboard (member card projection: member number, CVC,
  QR decision).
- P1-3 Activity center: RPC filters + grouped/filtered UI (+ balance-after display).
- P1-4 Reward benefit value rendering.
- P1-5 Summary retitle + per-merchant breakdown row.
- P1-6 Move Account block below loyalty content.
- P1-7 Public card SEO/copy rebrand (`WAKA Loyalty`, "Your WAKA loyalty card", "Powered by WAKA").

**P2 (polish)**
- Wallet-config probe caching; `truncated` surfacing; points-expiry display; renewal guidance;
  section chips for 5+ merchants; locale-aware dates; `role="progressbar"`; public card dark
  mode; live shell `<title>`; stale WAKA SEO tests; card wordmark asset decision.

## 26. Implementation Phases

- **Phase A — Frontend-only** (no backend): P0-1 branding, P1-1 i18n + toggles, P1-4 reward
  benefits, P1-5 summary wording, P1-6 account placement, P1-7 SEO copy, P2 caching/truncated/
  dates/progressbar/a11y polish.
- **Phase B — Member projections (backend, projection-only, no schema change)**: wallet state
  object; card identity fields (member number/CVC + QR decision); points-expiry field.
  Then frontend: wallet states (P0-2) + dashboard card section (P1-2).
- **Phase C — Activity Center**: extend `loyalty_member_activity` params; build the filtered,
  grouped UI (P1-3).
- **Phase D — Optional**: section chips, public-card dark mode, stale-test cleanup, card asset
  rebrand decision.

Each phase is independently shippable; none touches ledger, RLS posture, or merchant flows.

## 27. Explicit Non-Goals

- No change to ledger/accounting, redemption rules, enrollment authority, or RLS posture.
- No pooling of points across merchants; no cross-merchant redemption.
- No claim of wallet "installed" state; no new payment-card aesthetics or network branding.
- No phone digits as credentials; no new identifiers invented (hash derivation only).
- No new translation mechanism; no merchant Phase 2 redo; no staff/auth work.
- No schema changes (projection/RPC-parameter extensions only).

## 28. Regression Risks

| Risk | Level | Mitigation |
|---|---|---|
| Rebranding strings breaks SEO tests already stale (WAKA expectations) | LOW | Update tests together with P1-7/P0-1 (they are already failing at baseline — §U16) |
| Wallet-state projection changes break merchant button | LOW | Additive fields only; merchant path untouched |
| Activity RPC parameter extension breaks existing cursor callers | MEDIUM | New params nullable/defaulted; existing signature remains valid |
| Dashboard i18n migration misses a string | MEDIUM | Source-scan test for `t()` coverage (pattern exists in Phase 2) |
| Exposing `qr_token` to member session | MEDIUM | Security review choice (§22 options); prefer server-rendered QR if in doubt |
| Moving Account block confuses muscle memory | LOW | Visual, non-functional |
| Caching wallet-config probe hides configuration changes | LOW | Cache per mount only |

## 29. Acceptance Criteria (for the future implementation)

- [ ] No customer-visible "WAKA" remains on loyalty.dkasu.com surfaces (copy, SEO, card
      wordmark, assets per asset decision); internal identifiers untouched
- [ ] Wallet button label reflects issued/stale/unusable state from backend fields; never
      claims "installed"
- [ ] Dashboard renders in en/lg/sw via `t()`; language toggle present on `/member`; dates
      localized; no raw keys or RPC codes
- [ ] Dashboard shows premium cards per merchant with MEMBER ID, VALID THRU, POINTS, decorative
      CVC, and (per chosen option) scannable QR; no phone-derived secrets
- [ ] Activity supports date range + merchant + type filters server-side; grouped by day;
      balance-after visible; pagination preserved
- [ ] Rewards show benefit value and keep merchant ownership unambiguous
- [ ] Aggregate points labeled and accompanied by per-merchant breakdown; pooling language
      absent everywhere
- [ ] Account block sits below loyalty content
- [ ] Customer isolation regression: no member read returns another member's rows (existing
      projection tests still pass); tokens still absent from projections unless the QR option
      explicitly approves it
- [ ] No schema/RLS/accounting changes; no commits of unrelated work
- [ ] Mobile 320–414px pass; dark mode pass; keyboard/focus pass

---

### §24 — Final Decision Questions (explicit answers)

1. **One long page or sections/tabs?** Keep one scrolling page (wallet feel) and add lightweight
   anchored section chips when merchants ≥3. Not a tabbed split — it would hide the
   multi-merchant story.
2. **All merchant memberships on one dashboard?** Yes — already true; preserve it.
3. **Show aggregate points?** Yes, but retitle ("Points across merchants", active merchants
   only) and add a per-merchant breakdown row beneath it. Keep the existing disclaimer.
4. **How explained?** Aggregate = convenience only; every balance remains merchant-held and
   redeemable only there — stated in the summary and repeated by the cards (current disclaimer
   text is good; move it adjacent to the retitle).
5. **A digital card per merchant?** Yes — one premium `WakaLoyaltyCard` per linked account.
6. **Exact card info?** DKASU logo/wordmark · ISSUED BY shop · MEMBER name · MEMBER ID (derived
   hash) · VALID THRU (membership expiry, MM/YY) · POINTS (that merchant) · decorative CVC
   (derived, labeled non-security) · QR membership token. No network branding, no phone digits.
7. **Replace repeated "Add"?** Issue-state labels: Add (not issued) / Open in Google Wallet
   (issued) / Update wallet card (stale sync) / hidden when unusable — backed by
   `google_wallet_*` fields.
8. **Can backend know "installed"?** No — no Google save-state signal exists here; only
   issued/synced are knowable. UI must never claim installed.
9. **Date filters without backend changes?** None that are honest — the RPC has only
   cursor+limit. Client-side filtering over a cursor page would hide data silently.
10. **Requires backend/RPC work?** Activity filter params; wallet-state fields in member
    dashboard; card identity fields (+QR decision); points-expiry field; optional rewards
    paging. All projection/parameter-level — no schema change.
11. **Frontend-only?** Branding, dashboard i18n + language toggle, reward benefit display,
    summary retitle/breakdown, Account placement, SEO copy, wallet-config caching,
    `truncated` surfacing, date localization, section chips, progressbar roles, a11y polish.
12. **P0?** Customer-visible WAKA branding (U1); dishonest wallet button state (U2).
13. **P1?** Dashboard i18n + toggles (U3); dashboard premium cards (U4); activity center (U5);
    reward benefit display (U6); summary clarity (U7); Account placement (U8); public-card SEO
    copy (U9).
14. **Explicitly NOT changed?** Ledger/accounting; auth.uid() projection isolation; token
    non-exposure (unless QR option approved); points pooling rules (none exist — keep it that
    way); merchant-driven redemption; enrollment claim rules (no auto-link); RLS; phone-masking;
    cursor pagination core; realtime enrollment flow.
15. **Next implementation phases?** Phase A frontend-only (branding/i18n/reward value/summary/
    account/SEO) → Phase B member projections (wallet state + card fields) → Phase C activity
    center → Phase D polish. (§26)

---

*End of audit. This document is the source of truth for the next implementation phase.*
