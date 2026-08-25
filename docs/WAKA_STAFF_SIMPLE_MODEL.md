# WAKA Staff — Simple Model

**Phase 1 documentation only.**  
This document explains how Staff works today in production language. It does not change behavior, schema, or code.

Internal engineering terms (SessionActor, Path L / Path S, authRole mapping) are described only where needed so developers stay aligned with owners’ mental model:

```text
Staff Member → Role → Permissions → Actions
```

---

## 1. Staff Member lifecycle

### What a Staff Member is

A **Staff Member** is a person who can sell or work in the shop:

- They have a **name** and a **role** (e.g. Cashier, Manager).
- They may unlock a shared terminal with a **PIN**.
- They may also have a personal **email/password** WAKA account (after invite).

Cloud employment profile: `shop_pos_staff`.  
Local offline/sync mirror: `preferences.staffAccounts` (cache — not a second product concept).

---

### How an owner creates staff

1. Owner opens **Staff / Team** in Back Office.
2. Owner adds an employee (name, role, PIN or password).
3. WAKA creates / upserts a **staff profile** in the shop (`shop_pos_staff`).
4. Devices sync that profile so PIN login and the lock screen can find them.

Creating staff does **not** by itself create a separate email login. PIN-only staff can work on the shared terminal until invited.

---

### How invitations work

1. Owner invites a staff member by **email** (optional: attach an existing PIN profile).
2. Cloud stores a one-time invite (`shop_staff_invitations`).
3. Invitee opens the link → `/staff/accept` → creates or signs in with **email/password**.
4. On accept:
   - They join the shop as a member (`shop_members`).
   - Their Auth user is **linked** to the staff profile (`shop_pos_staff.user_id`).
5. Later they can sign in on **their own phone/browser** with email/password (personal account), without using seller PIN mode.

Invite roles:

- Membership role → what they can do when signed in with email (`shop_members.role`).
- POS role → employment / PIN profile role on `shop_pos_staff`.

---

### How PIN staff works (shared terminal)

Typical shop tablet / register:

1. **Owner** (or the shop account) is already signed in.
2. Terminal may be **locked**.
3. Someone chooses a **seller** and enters that seller’s **PIN**.
4. Sales are attributed to that seller; the **shop account** remains the signed-in operator.

PIN unlock does **not** replace email login. It selects **who is selling** on this device.

---

### How email staff works (personal device)

1. Invited person accepts and has email/password.
2. On another device they open WAKA → **Sign in** with email/password.
3. They enter the POS as **themselves** (their Auth user + membership role).
4. They must **not** be forced into “Choose seller / PIN” as if they were a shared terminal.

PIN remains available for **shared terminals**, not as the primary account login for invited staff.

---

## 2. Login model

### Operator identity

**Who is signed into the system** on this device.

Examples:

- Owner email session → operator = owner.
- Invited cashier email session → operator = that cashier.
- Shared terminal with owner JWT still active → operator stays the owner even after a seller PIN unlock.

### Seller identity

**Who performed the commercial sale** (for receipts, reports, “my sales”).

Examples:

- Owner selling alone → seller = owner.
- Owner terminal, John unlocked by PIN → seller = John.
- John signed in with email on his phone → seller = John (same as operator).

### Why they are separate

On a **shared shop terminal**, many sellers take turns, but the device stays signed in as the **shop/owner account** for cloud sync, shifts, and device trust.

If PIN unlock replaced the signed-in account every time:

- Sync and permissions would thrash.
- “Who wrote this to the cloud?” would be unclear.
- Offline/shared-tablet workflows would break.

So WAKA keeps:

| Concept | Question it answers |
|---|---|
| Operator | Who is authenticated on this device? |
| Seller | Who should get credit for this sale? |

Engineers implement this with an internal session object (SessionActor). **Owners never need that name.**

### Examples

| Situation | Operator | Seller |
|---|---|---|
| Owner logged in, selling alone | Owner | Owner |
| Owner logged in, John PIN unlock | Owner | John |
| John email/password on his phone | John | John |
| Offline PIN-only session on a cached shop | Staff session | That staff profile |

---

## 3. Roles and permissions

Simple chain:

```text
Staff Member
      │
      ▼
    Role
      │
      ▼
 Permissions
      │
      ▼
   Actions
```

### Examples

**Cashier**

- Allowed (typical): create sale, print receipt, add customer.
- Blocked (typical): refund, change price, view profit, manage staff.

**Manager**

- Allowed (typical): cashier actions plus more back-office (stock, some reports, day close — per matrix).
- Still blocked from some owner-only settings.

**Owner**

- Full shop control: staff, settings, billing-facing shop controls, all reports (subject to plan entitlements).

### Custom roles

Owners can define **custom roles** (stored with shop preferences today) and assign permission sets to staff profiles. Product meaning stays the same:

```text
Custom role name → list of allowed actions → assigned to Staff Member
```

### Where roles live (developers)

| Layer | Meaning |
|---|---|
| `shop_members.role` | Operator role for email/password members |
| `shop_pos_staff.role` (+ custom role id) | Employment / PIN profile role |
| Client permission matrix + custom role snapshots | Which actions the UI/store allow |

Server RPCs and RLS remain the **cloud** authority; the client matrix must stay aligned.

---

## 4. Sale attribution

When a sale is saved to the cloud:

| Field | Meaning |
|---|---|
| **`created_by`** | Who performed the **write** (authenticated operator / device writer). |
| **`sold_by_user_id`** | Who receives **sales attribution** (commercial seller Auth user), when known and valid for the shop. |

### Why both exist

- Shared terminal: operator may be the **owner**, seller may be **John** → reports show John’s sales; sync still uses the owner session.
- Personal email login: operator and seller are usually the **same** person.
- Unlinked PIN-only seller: attribution may be incomplete in cloud until the profile is linked to an Auth user; local history can still show the PIN profile.

**Rule:** never collapse these into one field for shared-terminal shops.

---

## 5. Current database concepts

No migrations proposed. This is a map of **what already exists**.

### `shop_members`

- **Purpose:** “This Auth user belongs to this shop” with a membership **role**.
- **Used for:** email/password access, operator role resolution, validating `sold_by_user_id` is a shop member.

### `shop_pos_staff`

- **Purpose:** Staff **profile** for the shop — name, POS role, PIN/secret material, active/suspended, optional `user_id` link to Auth.
- **Used for:** Team list, PIN unlock, offline staff cache, linking invitees to a seller profile.

### `shop_staff_invitations`

- **Purpose:** One-time invite tokens (hashed at rest) so owners can onboard email staff safely.
- **Used for:** invite send + `/staff/accept` accept flow.

### Local `staffAccounts` cache

- **Purpose:** Offline/sync mirror of shop staff inside the device shop snapshot (`preferences.staffAccounts`).
- **Used for:** lock screen picker, offline PIN auth, UI before/while cloud sync.
- **Not** a separate business entity — treat as cache of `shop_pos_staff`.

### Custom roles

- **Purpose:** Owner-defined roles with permission lists (`preferences.customStaffRoles`), referenced by staff profiles.
- **Used for:** Roles center and non-standard job titles without changing core enums yet.

### Related (attribution)

- `sales.created_by` — writer.
- `sales.sold_by_user_id` — seller Auth user when linked/valid.

---

## 6. Rules that must never break

These are production invariants. Refactors and UI cleanup must preserve them.

| Rule | Why |
|---|---|
| **Supabase Auth** | Email/password and cloud identity stay on Supabase — do not replace. |
| **PIN login** | Shared-terminal unlock and offline PIN auth must keep working. |
| **Offline mode** | Selling and staff cache without network must keep working. |
| **SessionActor / operator–seller split** | Internal model for operator vs seller must remain. |
| **Seller attribution** | `created_by` vs `sold_by_user_id` semantics must remain. |
| **Existing Staff V2 behavior** | Invite accept, link constraints, lock gating for personal devices, sync of staff profiles — keep working. |

Do **not** expose internal names (SessionActor, Path L/S, authRole mapping) in owner-facing UI.

---

## Quick reference — who uses what

| Person / device | Signs in with | Sells as |
|---|---|---|
| Owner on register | Email/password | Self or PIN seller |
| Cashier on register (shared) | (Owner already in) + seller PIN | That seller |
| Cashier on own phone | Email/password | Self |

---

## Document status

| Item | Status |
|---|---|
| Phase | **1 — documentation only** |
| Code / SQL / folders | **Unchanged** |
| Next (when approved) | Phase 2 — `src/features/staff/**` re-export barrels, no behavior change |

---

*Last updated: Staff V2 post Phase 11 (login clarity / personal-device lock hardening). Align future Staff Center UX with this simple model.*
