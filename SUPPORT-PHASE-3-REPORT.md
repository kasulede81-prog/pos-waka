# WAKA POS — PHASE 3 LIVE SUPPORT SESSION — FINAL REPORT

Date: 2026-09-17 · Branch: `waka/historical-financial-correction` · Migration applied to production Supabase (`ljaedextsenbkxzzgxcg`)

**FINANCIAL CORE TOUCHED: NO**

Final status: **GREEN** (implemented + tested + live verified)

---

## 1. Files changed

| File | Change |
|---|---|
| `supabase/migrations/20260917130000_support_phase3_live_sessions.sql` | **New migration** — sessions, events, RLS, RPCs, trigger, cron, realtime publication |
| `src/lib/supportSessions.ts` | **New** — session API: RPC wrappers, types, route allowlist, pure helpers |
| `src/lib/supportSessions.test.ts` | **New** — 9 unit tests (allowlist mirror, sensitive-route exclusion, countdown, open-state, latest-route) |
| `src/lib/supportRealtime.ts` | Extended — `subscribeShopSupportSessions`, `subscribeSupportSessionFeed`, `subscribeAdminTicketSession` (+ hooks) |
| `src/hooks/useSupportSessions.ts` | **New** — React Query hooks for sessions/events and all mutations |
| `src/components/support/SupportSessionBanner.tsx` | **New** — merchant AppShell banner (requested / agent-waiting consent / active / ended notice) |
| `src/components/support/merchant/MerchantLiveSessionSection.tsx` | **New** — ticket-page entry: request CTA + consent dialog + allow/decline |
| `src/components/internal-admin/v2/ops/AdminLiveSessionPanel.tsx` | **New** — admin console panel: request, approve/decline, countdown, guide-to routes, activity feed, end |
| `src/components/internal-admin/v2/ops/MerchantTicketsConsole.tsx` | Panel embedded in expanded ticket |
| `src/components/layout/AppShell.tsx` | Banner mounted (hidden on POS sell / login / internal-admin routes) |
| `src/pages/SupportTicketDetailPage.tsx` | Live-session section mounted |
| `src/lib/i18n.ts` | 33 new keys × (en, lg) |

## 2. New database objects

- **`merchant_support_sessions`** — `id, ticket_id→tickets, shop_id→shops, support_user_id, status (requested|active|expired|revoked|ended), duration_minutes (5–60, default 30), requested_by, requested_by_role (merchant|support), approved_by, created_at, approved_at, expires_at, ended_at, ended_by, ended_reason (merchant_stop|admin_end|ticket_closed|expired|revoked|declined), metadata`
- **`merchant_support_session_events`** — `id, session_id, ticket_id, shop_id, support_user_id (nullable until an agent owns the session), event_type (10 curated values), route_path, label (server-capped 120 chars), metadata (server-sanitized: flat object, ≤10 keys, ≤80-char scalar values), created_at`
- Indexes: shop+status, support_user+status, expiry partial (`where status in ('requested','active')`), events by session/shop
- **Partial unique index**: one open session per ticket — `unique (ticket_id) where status in ('requested','active')` (database-enforced, Part 16)
- Trigger `trg_merchant_support_ticket_end_sessions` — closing a ticket ends its open sessions (`ended_reason='ticket_closed'`) with audit events
- pg_cron job `waka-expire-support-sessions` (`*/2 * * * *`) → `waka_expire_support_sessions()`

Schema intentionally differs from the spec's sketch (`merchant_user_id/started_at/revoked_at` → `requested_by/approved_at/ended_at/ended_reason`), which the spec explicitly permits; no information is lost.

## 3. New migrations

Exactly one: `20260917130000_support_phase3_live_sessions.sql` (idempotent; applied once to production; no existing migration touched; no reset).

## 4. RLS policies

- `merchant_support_sessions_select` / `merchant_support_session_events_select`: SELECT only, for `authenticated`, where caller is the session owner, a member of the shop (`user_can_access_shop`), or an internal role (`super_admin`/`support_admin`).
- `revoke all … from anon, authenticated` on both tables; `grant select` only. **No merchant DML exists** — every write is a SECURITY DEFINER RPC that re-derives authorization from `auth.uid()`.

## 5. RPCs

| RPC | Who | Guard |
|---|---|---|
| `waka_request_support_session(ticket, minutes)` | shop member | ticket open, single-open enforced, duration clamped 5–60 |
| `waka_admin_request_support_session(ticket, minutes)` | internal role | same; requester becomes prospective owner; **cannot self-activate** |
| `waka_respond_support_session(session, approve, minutes?)` | internal role | **merchant-initiated only**; approver becomes owner |
| `waka_merchant_respond_support_session(session, approve)` | shop member | **support-initiated only** — the explicit consent gate (Part 2) |
| `waka_revoke_support_session(session)` | shop member (instant kill) or the requesting agent cancelling their own pending request | server-enforced (Part 4 — not UI-only) |
| `waka_end_support_session(session)` | internal role | active sessions |
| `waka_support_session_event(session, type, label, route?, metadata?)` | **session owner only**, active **and** unexpired | event_type CHECK, route ∈ allowlist (else `route_not_allowed`), label capped, metadata sanitized |
| `waka_get_ticket_session(ticket)` | participant/internal | — |
| `waka_expire_support_sessions()` | DB owner / pg_cron only (revoked from API roles) | hard server-side expiry |
| `waka_support_session_allowlist()` | authenticated | read-only mirror for clients |

## 6. Realtime channels/subscriptions

Both tables added to `supabase_realtime` publication (guarded DO block) with `replica identity full`. Channels: `support-sessions-shop-<shopId>` (merchant banner: session INSERT/UPDATE + events), `support-session-feed-<sessionId>` (activity feed), `support-admin-session-<ticketId>` (console). All filters are RLS-scoped; every hook owns one channel and removes it on unmount (no polling; debounced refetch, no blind appends).

## 7. Session lifecycle

`requested → active → ended | revoked | expired`. Approval can come from either side depending on who initiated (`requested_by_role`); both transitions require the *other* party's explicit action, so there is no self-approval path (verified live and in SQL smoke tests). Closing the ticket force-ends open sessions; new requests on a closed ticket are rejected (`ticket_not_open`).

## 8. Consent mechanism

No implicit consent, no default approval. Merchant-initiated: merchant taps **Allow 30 min** in a consent dialog that spells out exactly what is shared (screen names only; no amounts, quantities, passwords, customer details) → the *agent* must then approve. Agent-initiated: merchant gets a persistent in-app consent banner (**Allow 30 min / Not now**) → nothing activates until the merchant allows. Either side can cancel while waiting.

## 9. Revocation mechanism

Merchant **STOP** is always visible while active (AppShell banner, persistent across routes). Revoke is enforced in the RPC (`status='revoked'`, `ended_by` merchant) — the owner immediately fails the `session owner AND active AND unexpired` gate on every subsequent event (`session_not_active`, verified server-side in smoke test).

## 10. Expiration mechanism

Default 30 min, server-configurable per request (arg clamped 5–60 in the RPC; DB CHECK as backstop). `expires_at` is set at approval time (or request time while waiting); the pg_cron sweep flips elapsed sessions to `expired` with an audit event every 2 minutes; every event write also re-checks expiry, so capability loss is immediate, not poll-bound.

## 11. Activity events

Curated labels only, server-capped and sanitized (no DOM, no HTML, no field values, no credentials, no queries — Part 9/21). Types: `session_requested, session_approved, session_started, route_changed, page_opened, record_viewed, dialog_opened, session_ended, revoked, expired` (spec's `session_revoked/session_expired` are covered by `revoked`/`expired`). Verified: a 200-char metadata value is stored capped at 80 chars; non-allowlist routes rejected.

## 12. Route allowlist

Server-enforced in `waka_support_session_allowlist()` (single source of truth; the RPC rejects anything else) and mirrored in the client for UI: `/office` Dashboard · `/stock` Inventory & Products · `/customers` · `/cash-expenses` Expenses · `/reports` · `/receipts` Receipts & Sales · `/settings` Settings (view). "Guide merchant to" buttons emit curated `route_changed` events. Excluded and documented: `/pos`, close-day, cash-drawer ops, purchases/voids, financial corrections, staff management, account delete, PIN settings.

## 13. Dangerous-action protection

A support session grants zero write paths and zero permission elevation (Part 12): the agent emits activity events only; every existing `RoleProtectedRoute`/permission check still gates the merchant app; the session owner check binds actions to one agent per session. Financially sensitive routes are simply not in the allowlist, and even the allowlisted Settings remains view/navigation assistance only (Part 13 — no modifiable-settings scope was built).

## 14. Audit integration

Full lifecycle is auditable from `merchant_support_session_events` (requested → approved → started → route activity → ended/revoked/expired), each row tied to session + ticket + shop + actor. No duplicate audit infrastructure was created; events are RLS-readable only by participants/internal roles.

## 15. Tests

- **New:** `supportSessions.test.ts` — 9/9 pass (allowlist mirror vs server function, sensitive-route exclusion, label keys, duration window, open-state matrix, countdown math, latest-route selection).
- **Support regression:** `supportRealtime.test.ts`, `supportFloatingButton.test.ts` — pass.
- **Full suite** (2 shards): 5,338 passed; 41 failed across 19 files — **all pre-existing, none in support**. Verified by re-running a representative subset on a clean stashed tree: identical failures (enterprise roles, pharmacy persist, product wizard drafts, recovery integrity, rs4b transport, staff v2, stale-resurrection, sync OBS). Financial test failures: none beyond that pre-existing set.

## 16. TypeScript

`node node_modules/typescript/bin/tsc -b --force` — **clean** (project-build mode; root `tsc --noEmit` is vacuous by tsconfig design).

## 17. Build

`vite build --mode production` — **success** (PWA generated, 20 s). (The earlier Vercel failure mode — an unused import under `noUnusedLocals` — was checked for again; none present.)

## 18. Live two-session verification

Executed on production DB + local dev build driving merchant app and `/internal/waka/support` console (same account acts as both roles; realtime crossed between the two surfaces):

1. ✅ Merchant: ticket WAKA-0002 → **Request live assistance** → consent dialog → **Allow 30 min**
2. ✅ Waiting state visible on ticket page *and* persistent AppShell banner
3. ✅ Admin console showed "Merchant asked for live assistance" → **Approve (30 min)**
4. ✅ Session active: countdown chip, guide-to route buttons, read-only hint, End session
5. ✅ Admin clicked **Inventory & Products** → merchant banner showed **"Agent is guiding you to Inventory & Products" without refresh**
6. ✅ Merchant **STOP** → session revoked; admin capability gone (banner cleared)
7. ✅ Admin **Request live assistance** → merchant got **"A WAKA agent is asking to guide you live"** consent banner without refresh → **Allow** → active again
8. ✅ Admin **End session** → merchant banner cleared; ticket untouched
9. Server-side negatives proven in rolled-back SQL smoke tests: double request rejected, closed-ticket request rejected, ticket close ends open sessions (`ended_reason='ticket_closed'`), events on revoked sessions rejected, disallowed routes rejected, merchant-initiated vs support-initiated respond paths are strictly separated, expiry sweep expires and audits.

## 19. Git status

Working tree contained only the Phase 3 files listed in §1 before commit; temp smoke scripts and the DB runner were removed before committing. No financial files touched (diff inspected: only support/i18n/layout/migration files). Commit + push to `origin waka/historical-financial-correction` (`https://github.com/kasulede81-prog/pos-waka.git`) follow this report.

## 20. Commit hash

`64ebcba` — pushed to `origin waka/historical-financial-correction` (https://github.com/kasulede81-prog/pos-waka.git). Migration `20260917130000_support_phase3_live_sessions.sql` was applied to production before the push.

## 21. Limitations

- **Part 7 "inspect supported records"** is represented as curated `record_viewed`/`page_opened` events (labels only, no record contents); there is deliberately no remote rendering of merchant screens.
- The ended/expired transient notice fires on in-app state transitions; a full page reload after a session ended shows no notice (nothing is active — by design).
- Same-account testing (merchant uid = super_admin) meant the "merchant cannot approve" negative path was validated via the `requested_by_role` gate in SQL rather than as a distinct human user; the gate itself is server-side and role-based.
- Capacitor/Android: the banner and consent use only React + Supabase realtime (no browser-only APIs); safe on all platforms. Admin "guidance" is advisory — it never drives the merchant device.
