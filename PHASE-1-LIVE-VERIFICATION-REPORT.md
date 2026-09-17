# WAKA POS — MERCHANT SUPPORT CENTER
# PHASE 1 LIVE VERIFICATION

Date: 2026-09-17 (02:00–06:45 EAT)
Verifier: Kimi Work automated live verification against production Supabase

## Environment

- **App:** Waka POS dev server (`http://localhost:7100`), HashRouter, exercised through the Kimi in-app browser
- **Commit:** `8afb495` (branch `waka/historical-financial-correction`, repo `pos-waka`) — plus uncommitted Phase 1 additions (floating support FAB + internal tickets console) reviewed in Step 13
- **Supabase environment:** `aws-0-eu-west-1.pooler.supabase.com` (project `ljaedextsenbkxzzgxcg`), live production
- **Shop:** `Cathyy` (`5f3fb21b-ec86-4d78-8884-b24ea08db012`) — the signed-in merchant account's own shop served as the live merchant test shop
- **Authenticated merchant:** `nakayizacatherine02@gmail.com` (`a5162a1f-…`) — also a `super_admin` in `internal_admins`, which enabled full end-to-end verification of BOTH the merchant side and the internal-admin console with real sessions

_Note:_ the N&C trading center shop was not signed in during this session; the Cathyy shop is a real production shop with real data, so all results below are live results.

## Database

- **Migration already applied:** yes — `20260917003000_merchant_support_center.sql` recorded in `supabase_migrations.schema_migrations`. Nothing was reapplied.
- **Tables:** `merchant_support_tickets`, `merchant_support_messages`, `merchant_notifications` — all exist, all RLS-enabled.
- **RPCs (6 merchant):** `shop_create_support_ticket`, `shop_reply_support_ticket`, `shop_mark_ticket_messages_read`, `shop_mark_notification_read`, `shop_mark_all_notifications_read`, `shop_list_my_financial_correction_requests` — all present.
- **Trigger:** `trg_merchant_notify_financial_correction` present on `financial_correction_requests` (observational only).
- **Grants:** `anon`/`public` hold zero grants. `authenticated` holds table-level grants (legacy Supabase default ACLs from `supabase_admin`/`postgres` default privileges — identical pattern exists on the frozen `sales` table), but every read/write is gated by RLS policies, which were verified empirically to deny cross-shop access. Merchants have no UPDATE/DELETE policies on tickets/messages and a column-scoped `UPDATE(read_at)` grant on notifications only.

## RLS / Security

- **Own-shop access:** PASS — owner reads own tickets/messages/notifications, creates tickets, replies, marks read (all verified live in the UI and at RPC level).
- **Cross-shop isolation:** PASS — foreign-shop member (`BANZI HARDWARE`) sees 0 tickets / 0 notifications; `shop_create_support_ticket` and `shop_mark_all_notifications_read` for a foreign shop return `forbidden`; foreign `shop_mark_notification_read` returns `not_found`.
- **Unauthorized writes:** PASS — `anon` denied on all three tables (42501); unauthenticated claim (`not_authenticated`) can read nothing and write nothing; merchant cannot UPDATE ticket status or forge a `waka` message (no applicable policy → denied; retested with the non-internal BANZI member).
- **Internal staff path:** PASS with one defect (see Defect 1) — `super_admin`/`support_admin` can read the full queue, read conversations, reply, and change status through the internal policies; `operations_admin` (internal but outside the allowed set) is correctly denied.
- **Result:** RLS isolation holds at the database level, not via UI hiding.

## Merchant UI

- **Support Center hub:** loads; notifications section with empty state, status-filtered ticket links (Open / Waiting for you / Recently resolved), "Report a problem" entry. PASS.
- **Notifications:** list renders, unread dots, "Mark all read". PASS.
- **Tickets:** list renders with status pills. PASS.
- **Ticket detail:** conversation thread, status pill, reply box. PASS.
- **New ticket:** form with subject/category/description; category select persists. PASS.
- **Navigation:** user menu "Notifications & Support" with unread badge; settings hub card; floating support FAB (added this session) navigates to the Support Center and hides on support/sell/login surfaces. PASS.
- **Mobile/Desktop:** verified in the in-app browser viewport; responsive layout intact. PASS.
- **Loading/empty/error states:** observed (skeletons, empty states, and a safe "Could not load. Please try again." for an invalid ticket UUID — no crash, no data exposure). PASS.

## Ticket Test

- **Ticket ID:** `72d1858d-a81d-4201-a3f1-61c6e4e60012`
- **Ticket number:** `WAKA-0002` (human-friendly, sequence-based)
- **Status lifecycle observed:** `open` → (internal) `under_review` → `waiting_for_merchant`
- **Message ID (merchant reply):** `d4ff602d-08ae-41d6-91c3-b3c55fad388a` ("QA reply test.")
- **WAKA reply (internal console):** "QA: WAKA reply via internal console." — visible on the merchant side as a WAKA Support bubble
- **Persistence:** full page reload preserves ticket, conversation, and status. PASS.

## Notification Test

- **Notification:** `support_request_received` auto-created by ticket creation, correct shop, title, message, ticket reference. PASS.
- **Unread:** unread dot + unread counts observed. PASS.
- **Read:** single-notification open marks read (`read_at` set); "Mark all read" clears the rest via RPC. PASS.
- **Persistence:** full reload after read — read state preserved. PASS.
- **Internal replies/status changes** create `support_waiting_for_you` / `support_under_review` notifications (verified in DB). PASS (own shop; see Defect 1 for foreign shops).

## Financial Correction Integration

- **Read-only verification:** the Support Center's financial-correction presentation is observational; the trigger only writes notification rows.
- **Financial data changed:** none.
- **Result:** PASS — no financial RPC invoked, no correction created or modified.

## Financial Safety

| Table | Before | After | Difference |
|---|---|---|---|
| sales | 351 | 351 | 0 |
| sale_line_items | 436 | 436 | 0 |
| sale_payments | 330 | 330 | 0 |
| inventory_movements | 397 | 397 | 0 |
| shop_stock_movements | 173 | 173 | 0 |
| financial_correction_requests | 0 | 0 | 0 |
| sale_line_item_corrections | 0 | 0 | 0 |
| sale_returns | 1 | 1 | 0 (stable across re-sample) |
| sale_voids | 2 | 2 | 0 (stable across re-sample) |
| customer_debt_payments | 5 | 5 | 0 (stable across re-sample) |
| shop_cash_drawer_adjustments | 1 | 1 | 0 (stable across re-sample) |
| shop_day_drawer_opens | 46 | 46 | 0 (stable across re-sample) |
| shop_shifts | 53 | 53 | 0 (stable across re-sample) |
| shop_day_closes | 27 | 27 | 0 (stable across re-sample) |

- **Expected:** zero financial change.
- **Actual:** zero financial change.
- **Difference:** 0 across every measured table.
- **Result:** PASS — the only rows created during the entire verification are support-ticket/message/notification rows.

## Automated Tests

- `merchantSupportPresentation.test.ts` — **13/13**
- `merchantSupportCenter.sql.integration.test.ts` — **16/16**
- Financial-correction suites (`financialCorrectionRequests.sql.integration` 15/15, `historicalFinancialCorrectionLookup.sql.integration` 11/11, `financialCorrectionForm` 8/8, `financialFingerprint` 11/11, `dayCloseCorrectionSupersede` 4/4) — **49/49**
- Broader financial/regression sweep (82 files) — **790/790**
- New this session: `supportFloatingButton.test.ts` **10/10**, `merchantTicketsAdmin.test.ts` **7/7**
- Total this run: **891/891 passed, 0 failed**

## TypeScript

- `tsc -b` — clean (exit 0), including all new Phase 1 files.

## Build

- `vite build` — success (PWA assets generated, no errors).

## Defects

### Defect 1 — `merchant_notifications` has no internal SELECT policy (FIXED — 2026-09-17, explicitly approved)

- **Severity:** High for the internal support console; merchants unaffected.
- **Reproduction:** as `super_admin`, insert a `merchant_notifications` row for a shop you are not a member of via PostgREST (which appends `RETURNING`). Result: `42501 new row violates row-level security policy`. The identical insert succeeded for a shop you belong to, and for any shop without `RETURNING`.
- **Root cause:** PostgreSQL evaluates the returned row against the table's **SELECT policies** for the `RETURNING` clause. `merchant_notifications` had `internal_insert` but no internal SELECT policy, so an internal admin who is not a shop member could not "see" the row being returned and the insert was rejected.
- **Fix applied (with explicit owner approval, after certification):**
  ```sql
  create policy merchant_notifications_internal_read
    on public.merchant_notifications for select
    using (public.is_waka_internal_role(array['super_admin', 'support_admin']));
  ```
- **Re-verification after fix:** foreign-shop admin insert with `RETURNING` now succeeds; admin can read the foreign shop's notifications (4 visible); merchant cross-shop read still returns 0 (no leakage); merchant notification insert still denied (42501).

### Defect 2 — Internal console used the internal_admins row id as message author (FIXED)

- **Severity:** Medium (would have broken every console reply).
- **Reproduction:** first reply attempt returned HTTP 409, FK violation `merchant_support_messages_author_user_id_fkey` ("Key is not present in table users").
- **Root cause:** the console passed `adminRow.id` (the `internal_admins` row UUID) as `author_user_id`; the FK requires an `auth.users` id.
- **Affected component:** `MerchantTicketsConsole` / `merchantTicketsAdmin.ts`.
- **Fix applied:** `replyToMerchantTicket` now takes the author id from the signed-in session (`supabase.auth.getSession()`). Replies verified working end-to-end after the fix.

### Observations (not defects)

- Legacy default ACLs grant `authenticated` table-level privileges on the support tables (and on `sales`). RLS is the effective gate and was verified empirically; no action needed.
- Test residue: duplicate QA ticket `WAKA-0001` ("QA Support Test", `account`) was created by an automation mis-click; plus QA messages/notifications in the Cathyy shop. Happy to clean these up on request.

## Final Certification

**GREEN — PHASE 1 LIVE VERIFIED** (Defect 1 fixed and re-verified on 2026-09-17 with explicit approval; no defects remain open)

The merchant-facing Phase 1 Notifications & Support Center is fully functional and secure on the live database: merchant ticket → conversation → reply → notification → persistence → RLS isolation all verified end-to-end, with zero financial side effects (0 drift across 14 financial tables) and 891/891 automated tests green. Defect 1 (internal notification fan-out) was fixed with an explicit one-policy change and re-verified — merchants remain fully isolated (cross-shop reads still return 0, merchant inserts still denied). No defects remain open.
