# WAKA POS — Live Admin Session Viewing: Architecture Investigation

**Status: DESIGN ONLY — NOT IMPLEMENTED (Phase 2.5, Parts 14–16)**

This document investigates whether WAKA could one day offer
*"Allow WAKA Support to view my screen/session"* — transparent guided
assistance where a merchant grants temporary consent and a WAKA support admin
can follow what the merchant sees inside WAKA POS. It deliberately concludes
with a **go/no-go** and does not ship code.

---

## 1. Desired experience

1. Merchant explicitly requests support (or approves a request from WAKA).
2. Merchant grants **temporary, revocable** authorization.
3. A WAKA support admin enters a bounded support session.
4. The admin sees, in real time: current route/page, navigation, clicks,
   selected UI elements, important actions, and (if feasible) a support
   cursor overlay.
5. The merchant always sees **"Stop Support Session"** and can revoke instantly.

## 2. Hard boundaries (absolute)

- **Never** the merchant's password, session cookies, auth tokens, or refresh
  tokens. Admin auth is their own.
- **Never** arbitrary browser/device control, unrelated tabs, other apps, or
  anything outside the WAKA POS application surface.
- **Never** a general-purpose screen recorder. This is guided assistance, not
  surveillance.
- **Never** capture values of sensitive fields (passwords, PINs, payment
  credentials, secrets) — by design, not by policy alone.

## 3. Proposed architecture (event mirroring, not screen sharing)

The only architecture that satisfies §2 inside the existing stack is
**structured event mirroring over Supabase Realtime**, reusing the Phase 2.5
realtime plumbing:

```
Merchant app (WAKA POS)
  ├─ router listener           → route_changed {path, title}
  ├─ coarse interaction layer  → button_clicked {uiKey}, dialog_opened {uiKey},
  │                              tab_opened {uiKey}, record_viewed {entity, idHash}
  └─ consent-gated emitter ──► support_session_events (RLS: session-scoped)
                                    │
  Admin console viewer  ◄───  Supabase Realtime (postgres_changes, session filter)
```

Key design decisions:

| Concern | Decision |
|---|---|
| What travels | **Semantic UI events** (`uiKey` design-system identifiers), never pixels, never DOM/HTML, never field values |
| Direction | Merchant → Admin only; admin has **no write path** into the merchant app |
| Transport | Supabase Realtime `postgres_changes` on a new `support_session_events` table, filtered `session_id=eq.<id>`, RLS-scoped to the two participants |
| Resolution fidelity | Route + labeled actions (not pixel-perfect). A "support cursor" would require additional pointer-coordinate events; technically feasible in-browser, awkward on mobile/Capacitor — recommend **not** committing to it initially |
| Existing precedent | The `remote_support_*` control-plane tables (migration 151) already model request/approve/decline/end lifecycles — the consent model below mirrors that proven pattern |

## 4. Session authorization & consent model

New table (design only): `support_view_sessions`

| Field | Notes |
|---|---|
| `id` uuid pk | |
| `ticket_id` | links to `merchant_support_tickets` |
| `shop_id` | RLS scoping |
| `merchant_user_id` / `admin_user_id` | both must be authenticated auth.users ids |
| `status` | `requested` → `active` → `ended` / `revoked` / `expired` |
| `created_at` / `approved_at` / `expires_at` / `revoked_at` | `expires_at` ≤ 30 min hard cap |

Consent flow (mirrors Phase 1/2.5 patterns):

- Merchant sees: *"Support session requested by WAKA Admin"* → **[Allow for
  30 minutes]** **[Cancel]**.
- Merchant can press **"Stop Support Session"** at any time → `revoked_at`.
- Admin **cannot** extend; a new approval is required after expiry/revocation.
- All transitions emit audit events (`support_session_started`,
  `support_session_ended`, `merchant_revoked_session`).

## 5. Realtime event model

New table (design only): `support_session_events`

```
id, session_id (indexed, realtime filter), seq (monotonic per session),
event_type, ui_key, metadata jsonb (sanitized), created_at
```

Event taxonomy from Part 16: `route_changed`, `button_clicked`,
`tab_opened`, `dialog_opened`, `record_viewed`, `support_session_started`,
`support_session_ended`, `merchant_revoked_session`.

**Sanitization rules (enforced in the emitter, reviewed in code):**
- `ui_key` comes from a **developer-curated registry** (e.g.
  `sell.checkout.button`, `inventory.product.row`) — free-text labels are
  never sent.
- `metadata` may contain entity **hashes/ids** (e.g. `saleId` short hash) but
  never amounts, names, phone numbers, or field contents.
- Deny-list enforcement for anything matching password/PIN/token input
  ancestry in the DOM capture layer.

## 6. Security boundaries

- **RLS on both tables**: merchant sees own shop's sessions/events; admin sees
  sessions where they are the assigned admin; nobody else sees anything.
  Same pattern as `merchant_support_*` (Phase 1) — proven.
- **Realtime is RLS-filtered per subscriber** (Phase 2.5 pattern): subscribe
  with `session_id=eq.<id>`; a merchant cannot receive another shop's events
  because the SELECT policy blocks it.
- **Server-enforced expiry**: a trigger (or the approval RPC) sets
  `expires_at`; an `is_session_active()` check gates event INSERTs; expired
  sessions reject writes.
- **No admin write path** to merchant app state: the admin console viewer is
  read-only over the event stream.

## 7. Revocation, timeout, audit

- Revocation is a single UPDATE by the merchant (`revoked_at = now()`),
  allowed by RLS only for the merchant participant; the realtime stream stops
  because subsequent events fail the active-session check.
- Hard timeout: 30 minutes; `expires_at` enforced server-side on insert of
  events.
- Audit: every session lifecycle transition and every event batch is
  persisted in the two tables above; a daily purge (same pg_net/cron pattern
  as Phase 2.5 attachment cleanup) can drop events older than N days.

## 8. What can / cannot be viewed

| Can | Cannot |
|---|---|
| Current route/page and navigation history (within WAKA) | Passwords, PINs, tokens, payment credentials |
| Clicked/pressed UI elements (by curated key) | Field values, typed text |
| Opened dialogs/tabs, viewed records (hashed refs) | Other browser tabs, other apps, OS-level content |
| Merchant's own live indicator ("WAKA is viewing") | Pixel-level screen or DOM snapshots |

## 9. Technical limitations

- **Browser (desktop)**: fully feasible with the event-mirroring model;
  pointer overlay feasible but optional.
- **Mobile web / Capacitor**: feasible for structured events; pointer
  overlay impractical; WebView lifecycle may pause the stream when the app
  backgrounds — acceptable (session is assistance, not monitoring).
- **Offline POS**: events queue locally and flush on reconnect; the admin
  sees a "merchant offline" state instead of a frozen screen.
- **Fidelity ceiling**: without pixel streaming (which would violate §2), the
  admin sees a **structured mirror**, not the exact screen. That is sufficient
  for guided assistance ("tap Reports, then Day close") but not for
  diagnosing rendering glitches — for those, Phase 2.5 attachments
  (screenshots) remain the tool.

## 10. Go / No-Go recommendation

**GO — as a bounded, event-mirroring feature** built on the existing
`merchant_support_tickets` + realtime + RLS architecture, **provided**:

1. The curated `ui_key` registry is adopted in the design system (one-time
   instrumentation cost across key screens).
2. Product accepts the fidelity ceiling in §9 (structured mirror, no pixels).
3. The consent UX ships first; the viewer ships without it disabled.

**NO-GO** for any variant requiring pixel streaming, DOM exfiltration,
cross-tab visibility, or admin-driven actions in the merchant app — those
violate the hard boundaries and the trust model of the product.
