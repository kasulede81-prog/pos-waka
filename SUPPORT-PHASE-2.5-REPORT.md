# WAKA POS — SUPPORT CENTER PHASE 2.5 — FINAL REPORT

**Real-time support messaging + temporary attachments + audio**

Date: 2026-09-17
Status: **GREEN — implemented, tested, migration applied to production, merchant-side flow live-verified**

---

## Headline

Phase 2.5 is implemented and live on production. Both migrations were applied
directly to the production database (no backlog replayed). The merchant-side
end-to-end flow (ticket → text reply → image attachment through the real UI →
storage object + metadata persisted under the server-enforced path) was
verified against the live system. Realtime delivery, admin-side rendering,
audio, and close-cleanup are covered by: DB smoke tests against the live
database (rolled back), unit tests (24/24 green), TypeScript (clean), and the
production build (success). A manual two-session pass (merchant tab + admin
console) remains as the final acceptance step.

**FINANCIAL CORE TOUCHED: NO**

No financial table, RPC, trigger, policy, calculation, permission or migration
was created or modified. The only pre-existing table altered is
`merchant_support_messages` (new `shop_id` mirror column for shop-scoped
realtime — support-only data, never read by financial logic). Verified: the
Phase 1 financial drift snapshot remains the reference and no financial object
appears in either migration.

---

## 1. Files changed

**New:**
- `supabase/migrations/20260917090000_support_phase25_realtime_attachments.sql`
- `supabase/migrations/20260917091500_support_phase25_cleanup_revision.sql`
- `src/lib/supportAttachments.ts` — MIME/size validation, path builder, upload, signed URLs
- `src/lib/supportRealtime.ts` — RLS-scoped subscription primitives + React hooks
- `src/components/support/AttachmentComposer.tsx` — 📎 picker + pending chips + 🎤 strip
- `src/components/support/AudioRecorderButton.tsx` — record/stop/cancel/preview/send
- `src/components/support/MessageAttachments.tsx` — image/audio/document cards, tombstones
- `src/lib/supportAttachments.test.ts`, `src/lib/supportRealtime.test.ts` (24 tests)
- `SUPPORT-SESSION-VIEWING-ARCHITECTURE.md` (Parts 14–16, design only)

**Modified:**
- `src/lib/merchantSupportApi.ts` — reply RPC gains attachments; attachment queries re-exported
- `src/lib/merchantTicketsAdmin.ts` — admin reply with attachments; attachment fetch
- `src/hooks/useMerchantSupport.ts` — `useTicketAttachments`, `useSupportCenterRealtime`
- `src/pages/SupportTicketDetailPage.tsx` — attachments, audio, realtime, closed-lock
- `src/pages/SupportTicketsPage.tsx`, `SupportCenterHomePage.tsx`, `NotificationsListPage.tsx` — realtime nudges
- `src/components/internal-admin/v2/ops/MerchantTicketsConsole.tsx` — realtime feed + thread, attachments, audio reply, read-only on resolved/closed
- `src/components/internal-admin/v2/pages/AdminSupportPage.tsx` — pass `lang`
- `src/lib/i18n.ts` — 15 new keys × (English + Luganda); Swahili falls back to English

## 2. New migrations

Two, applied to production in this order:
`20260917090000_support_phase25_realtime_attachments.sql` then
`20260917091500_support_phase25_cleanup_revision.sql` (revision 2 fixes two
defects found by live smoke testing: a `chr(0)` expression that PG16 rejects
on every call, and the storage-cleanup redesign — see §12).

## 3. Storage bucket configuration

- `merchant-support-attachments` — **private** (`public = false`), `file_size_limit = 20 MB`
- Path layout (enforced by RLS + RPC): `support/{shop_id}/{ticket_id}/{nonce}/{filename}`
- Access: short-lived signed URLs (300 s) created on demand; upload allowed
  only into the caller's own shop's replyable ticket (merchants) or any
  existing ticket (internal staff).

## 4. New tables

- `merchant_support_attachments` — metadata only (id, message_id, ticket_id,
  shop_id, storage_path, original_filename, mime_type, file_size_bytes,
  attachment_kind, created_at, deleted_at tombstone). Binaries are NEVER in PG.

## 5. New indexes

- `merchant_support_attachments` — (ticket_id), (message_id), (shop_id), (storage_path)
- `merchant_support_messages` — (shop_id)  [new column, backfilled]

## 6. RLS policies

- `merchant_support_attachments`: member SELECT (own shop), internal SELECT/INSERT (super_admin/support_admin). **No merchant DML** — metadata is created only inside the SECURITY DEFINER reply RPC.
- `storage.objects` on the new bucket: SELECT (internal, or attachment row visible to the shop, not tombstoned), INSERT (path matches a real shop ticket + member of that shop + ticket replyable, or internal), DELETE (internal; **or ticket CLOSED** — the cleanup gate; **or uploader with no metadata yet** — staging unwind).
- Phase 1 tables unchanged except publication/RLS behavior via realtime (RLS still enforced per subscriber).

## 7. RPCs / functions

- `shop_reply_support_ticket(uuid, text, jsonb)` — extended: attachments ride
  the single messaging RPC; validates count (≤5), path prefix (server-owned),
  MIME allow-list (jpeg/png/webp, pdf, webm/mp4/mpeg/ogg/wav), per-kind sizes
  (10 MB image/doc, 20 MB audio); rejects closed/resolved with
  `ticket_not_replyable` (server-side closed-ticket enforcement).
- `merchant_support_message_set_shop()` — trigger backfills `shop_id` (cannot be forged by clients).
- `support_cleanup_ticket_attachments(uuid)` — tombstones + enqueues Storage-API deletes via pg_net; never raises; idempotent.
- `merchant_support_ticket_cleanup_on_close()` — AFTER UPDATE trigger; fires only on transition **into** `closed` (the existing lifecycle's final state — RESOLVED can still transition, so cleanup does not fire there, matching the spec's state-machine rule).
- `waka_admin_reclean_ticket_attachments(uuid)` — internal-only idempotent retry.

## 8. Realtime configuration

- `merchant_support_tickets`, `merchant_support_messages`,
  `merchant_notifications` added to `supabase_realtime` publication
  (guarded, idempotent); `REPLICA IDENTITY FULL` on all three (UPDATE-event
  filters reference non-PK columns).
- Subscriptions are always scoped (`ticket_id=eq…` / `shop_id=eq…`) and
  authorized by the subscriber's JWT through RLS — there is deliberately **no
  global `merchant_support_messages:*` subscription**. Channels are removed on
  unmount; React Query invalidation (authoritative refetch) prevents duplicate
  rendering; stable message IDs key all bubbles.

## 9. Attachment lifecycle

Staged in composer → validated (client, then server) → uploaded to private
bucket → metadata created atomically with the message (one RPC transaction) →
displayed via signed URLs → **deleted when the ticket transitions to CLOSED**
(tombstone + Storage delete), including a sweep of orphan files under the
ticket prefix. Orphan staging files from failed sends are removable by the
uploader while no metadata exists.

## 10. Audio implementation

`MediaRecorder` behind an explicit press (permission is never requested on
page open). Record → stop → preview (`<audio>`) → send/cancel. Codec
negotiation (webm/mp4/ogg/mpeg), graceful denied/unavailable errors (EN+LG
copy), 20 MB cap, uploads as a normal `audio` attachment; rendered with a
native player on both sides.

## 11. Closed-ticket enforcement

- UI: composer hidden (merchant + admin console), read-only note shown.
- Server: reply RPC returns `ticket_not_replyable`; storage INSERT policy
  rejects uploads while the ticket is not replyable; attachment metadata has
  no merchant INSERT path at all. Verified against the live DB (below).

## 12. Cleanup mechanism

Hosted Supabase blocks direct `storage.objects` deletion
(`storage.protect_delete`) and the physical bytes live behind the Storage API,
so cleanup is: **close trigger → tombstone metadata → enqueue per-file DELETE
to the Storage API via pg_net's DB background worker** (no browser involved),
with the DELETE authorized by the closed-ticket RLS gate. `pg_net` and
`pg_cron` were installed; an hourly pg_cron sweep re-enqueues for tickets
closed in the last 24 h; the internal reclean RPC is the manual retry. All
paths idempotent (deleting a gone object is a harmless 404); cleanup can never
break ticket close (nested exception containment).

## 13. Tests executed

- New unit tests: **24/24 green** (validation, MIME normalization, filename
  sanitization, path building, recording classification, channel scoping,
  cleanup-on-unmount, no-wildcard-subscription assertions).
- Live DB smoke test (rolled back): ticket create → audio reply OK → bad MIME
  `invalid_attachment_type` → cross-shop path `invalid_attachment_path` →
  closed reply `ticket_not_replyable` → attachments tombstoned on close.
- Full vitest suite: all support/financial suites pass; the only failures
  (Electron remote-support, wizard drafts, staff/enterprise, sync
  observability) **reproduce identically on the clean tree** — pre-existing
  environment failures, zero regressions from this phase.

## 14. TypeScript result

`tsc --noEmit` — clean.

## 15. Build result

`vite build` — success (PWA generated).

## 16. Live verification result

- ✅ Merchant created ticket WAKA-0011 via the real UI.
- ✅ Merchant text reply persisted and rendered.
- ✅ Merchant image attachment staged (chip with name+size) → sent →
  **metadata row** (`image/png`, 666 B) **+ storage object** at
  `support/{shop}/{ticket}/{nonce}/p25-test-image.png` confirmed in production.
- ✅ New composer (attach + record) rendered from the hot-reloaded build.
- (Manual pass continues: admin sees reply without refresh; admin attachment;
  audio playback; status change realtime; close → objects deleted → merchant
  read-only + tombstones; reload persistence.)

## 17. Git status

All Phase 2.5 files committed and pushed on
`waka/historical-financial-correction` (see commit). Working tree clean.

## 18. Unresolved issues / notes

- **Pre-existing test failures** (42 across the full suite) are environmental
  and reproduce on the clean tree; none touch support or financial code.
- The two QA-residue tickets from Phase 1 (WAKA-0001/0002) are still in the
  Cathyy shop; WAKA-0011 is this phase's live-verification ticket. They can be
  closed at any time — closing WAKA-0011 will visibly trigger attachment
  cleanup.
- Signed URLs expire after 5 minutes; images/audio re-sign on demand, so
  long-lived open tickets are unaffected.
- Session-viewing (Parts 14–16) is **architecture only**, documented in
  `SUPPORT-SESSION-VIEWING-ARCHITECTURE.md` — recommendation: GO for bounded
  event-mirroring; NO-GO for anything pixel/DOM-level.
