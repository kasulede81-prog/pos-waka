# WAKA POS — Restaurant & Bar Mode (Hospitality Mode)

**Audience:** Ugandan restaurants, bars, pork joints, lounges, hotels, cafes, guest houses, fast food  
**Goal:** Full table-service workflow — open table → order many times → settle later — without losing Waka POS simplicity  
**Foundation:** Builds on [PENDING_SALES_DESIGN.md](./PENDING_SALES_DESIGN.md) (`sales.status = 'draft'`) and existing offline-first IndexedDB + Supabase sync

---

## Executive summary

Retail Waka POS: **Customer → cart → pay → done.**

Hospitality Waka POS: **Customer sits → table opens → orders accumulate → kitchen/bar prints → settle → table free.**

When a shop selects **Restaurant**, **Bar**, **Restaurant & Bar**, or **Hotel**, the app enters **Hospitality Mode**:

- Floor plan with colour-coded tables
- One running bill per table (backed by a draft sale)
- Kitchen and bar station printing
- Waiter assignment and shift tracking
- Split bill, merge tables, transfer table
- Revenue and profit only on **Settle Bill** (same rule as Pending Sales)

This is not a separate product — it is a **workflow layer** on top of the existing POS, catalog, stock, payments, and sync stack.

---

## Business types & mode activation

### Onboarding choices (user-facing)

| User label | Internal `business_type` | Hospitality Mode |
|------------|--------------------------|------------------|
| Simple Shop | `kiosk_duka` | Off |
| Wholesale Shop | `wholesale` | Off |
| Pharmacy | `pharmacy` | Off |
| Restaurant | `restaurant` | **On** |
| Bar | `bar` | **On** |
| Restaurant & Bar | `restaurant_bar` | **On** |
| Hotel | `hotel` | **On** (tables + room charge later) |

Migration `072_hospitality_business_types.sql` extends the check constraint on `shops.business_type` and `organizations.business_type`.

```typescript
const HOSPITALITY_TYPES = ['restaurant', 'bar', 'restaurant_bar', 'hotel'] as const;

export function isHospitalityMode(type: BusinessType | undefined): boolean {
  return !!type && (HOSPITALITY_TYPES as readonly string[]).includes(type);
}
```

### Profile defaults per hospitality type

| Type | Default areas | Default categories | Quick sell |
|------|---------------|-------------------|------------|
| Restaurant | Main Hall, Veranda | Food, Chicken, Pork, Fish, Soft Drinks, Water | On (food photos) |
| Bar | Main Bar, VIP, Outdoor | Beer, Wine, Spirits, Cocktails, Soft Drinks | On |
| Restaurant & Bar | Main Hall, Bar Area, VIP | Full food + drink set | On |
| Hotel | Restaurant, Bar, Pool Side | Food + drinks + room service stub | Off |

---

## 1. Database design

### 1.1 Design principles

1. **One open bill = one `sales` row with `status = 'draft'`** — reuses Pending Sales; no parallel order engine.
2. **Table state is derived** from the active `table_session` + linked draft sale, not stored redundantly (except cached `display_status` for fast floor UI).
3. **Kitchen/bar tickets are append-only** child records fired when lines are added.
4. **Stock moves only on `completed`** — existing trigger in `007_functions_and_triggers.sql` unchanged.
5. **All hospitality entities sync** via entity store + cloud snapshot, same as products/sales today.

### 1.2 Entity relationship (core)

```
shops
  ├── dining_areas
  │     └── dining_tables
  │           └── table_sessions ──► sales (draft → completed)
  │                 ├── sale_line_items
  │                 ├── kitchen_tickets
  │                 │     └── kitchen_ticket_items
  │                 └── bill_splits (optional, v1.1)
  ├── kitchen_stations
  └── products (metadata: station, is_food, is_drink)
```

### 1.3 New tables

#### `dining_areas`

Owner-defined zones (Main Hall, Veranda, VIP, etc.).

```sql
create table public.dining_areas (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, lower(trim(name)))
);
```

#### `dining_tables`

Physical tables within an area.

```sql
create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  area_id uuid not null references public.dining_areas(id) on delete cascade,
  label text not null,              -- "Table 1", "VIP 3", "Balcony A"
  capacity int check (capacity > 0),
  sort_order int not null default 0,
  -- Cached for floor UI; recomputed on session change
  display_status text not null default 'available'
    check (display_status in ('available', 'occupied', 'payment_pending', 'reserved', 'disabled')),
  is_active boolean not null default true,
  grid_x int,                       -- optional layout position (0–100 %)
  grid_y int,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, area_id, lower(trim(label)))
);
```

#### `table_sessions`

Links a table to an open bill for the duration of service.

```sql
create table public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  table_id uuid not null references public.dining_tables(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  guest_count int not null default 1 check (guest_count >= 1),
  customer_name text,
  customer_phone_e164 text,
  waiter_user_id uuid references auth.users(id),
  waiter_staff_id text,             -- local staff: "staff:abc" for offline PIN staff
  waiter_label text,              -- "Denis" denormalized for receipts/tickets
  status text not null default 'open'
    check (status in ('open', 'payment_pending', 'closed', 'cancelled', 'merged')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opened_by uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only one active session per table
create unique index table_sessions_one_open_per_table
  on public.table_sessions (table_id)
  where status in ('open', 'payment_pending');
```

#### `kitchen_stations`

Print destinations configured by owner.

```sql
create table public.kitchen_stations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,               -- "Main Kitchen", "Bar", "Grill", "Coffee"
  station_type text not null
    check (station_type in ('kitchen', 'bar', 'grill', 'coffee', 'other')),
  sort_order int not null default 0,
  is_active boolean not null default true,
  print_config jsonb not null default '{}'::jsonb,  -- printer name, copies, auto_print
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, lower(trim(name)))
);
```

Default seed on hospitality onboarding: **Main Kitchen** + **Bar**.

#### `kitchen_tickets`

Fired when food/drink lines are added (or on explicit "Send to kitchen").

```sql
create table public.kitchen_tickets (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  table_session_id uuid not null references public.table_sessions(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  station_id uuid not null references public.kitchen_stations(id) on delete restrict,
  ticket_number int not null,       -- per-shop daily sequence
  status text not null default 'queued'
    check (status in ('queued', 'preparing', 'ready', 'served', 'cancelled')),
  fired_at timestamptz not null default now(),
  prepared_at timestamptz,
  served_at timestamptz,
  waiter_label text,
  table_label text,
  area_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.kitchen_ticket_items (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.kitchen_tickets(id) on delete cascade,
  sale_line_item_id uuid references public.sale_line_items(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  notes text,
  metadata jsonb not null default '{}'::jsonb
);
```

#### `table_session_events` (audit trail)

Transfer, merge, split, waiter change — immutable log.

```sql
create table public.table_session_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  session_id uuid references public.table_sessions(id) on delete set null,
  event_type text not null
    check (event_type in (
      'opened', 'closed', 'transferred', 'merged', 'split',
      'waiter_assigned', 'payment_pending', 'cancelled'
    )),
  actor_user_id uuid,
  actor_label text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

#### `reservations` (v2 — schema ready, UI optional)

```sql
create table public.table_reservations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  table_id uuid references public.dining_tables(id) on delete set null,
  customer_name text not null,
  customer_phone_e164 text,
  reserved_for timestamptz not null,
  guest_count int,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'seated', 'cancelled', 'no_show')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

When reservation is active and within window → table `display_status = 'reserved'` (blue).

#### `bill_splits` (v1.1)

For split-bill without duplicating line items prematurely:

```sql
create table public.bill_splits (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  parent_session_id uuid not null references public.table_sessions(id),
  parent_sale_id uuid not null references public.sales(id),
  child_sale_id uuid not null references public.sales(id),
  split_type text not null check (split_type in ('equal', 'custom_amount', 'by_item')),
  label text,                       -- "Customer A"
  amount_ugx bigint not null check (amount_ugx >= 0),
  status text not null default 'open'
    check (status in ('open', 'paid', 'cancelled')),
  created_at timestamptz not null default now()
);
```

### 1.4 Extensions to existing tables

#### `sales`

```sql
alter table public.sales
  add column if not exists reference_label text,
  add column if not exists table_session_id uuid references public.table_sessions(id),
  add column if not exists service_type text default 'walk_in'
    check (service_type in ('walk_in', 'dine_in', 'takeaway', 'room_charge')),
  add column if not exists cancelled_at timestamptz;

-- Extend status for pending sales + hospitality
alter table public.sales drop constraint if exists sales_status_check;
alter table public.sales add constraint sales_status_check
  check (status in ('draft', 'completed', 'void', 'refunded', 'cancelled'));
```

Hospitality draft sale metadata:

```json
{
  "wakaClient": true,
  "hospitality": true,
  "tableSessionId": "uuid",
  "tableLabel": "Table 5",
  "areaName": "VIP",
  "guestCount": 4,
  "waiterLabel": "Denis"
}
```

#### `sale_line_items.metadata`

```json
{
  "stationId": "uuid",
  "stationType": "kitchen",
  "kitchenStatus": "queued",
  "notes": "No pepper",
  "firedAt": "2026-05-31T14:22:00+03:00",
  "addedByWaiter": "Denis"
}
```

#### `products.metadata`

```json
{
  "hospitality": {
    "stationId": "uuid",
    "stationType": "bar",
    "isFood": false,
    "isDrink": true,
    "autoFire": true
  }
}
```

#### `shops.settings` (jsonb)

```json
{
  "hospitality": {
    "enabled": true,
    "defaultGuestPrompt": true,
    "autoFireKitchen": true,
    "autoFireBar": true,
    "allowWaiterTableLock": true,
    "ownerOverrideAlways": true,
    "floorPlanLayout": "grid",
    "categoryPresets": ["beer", "wine", "food", "pork"]
  }
}
```

### 1.5 Roles

Extend `shop_members.role` and client `UserRole`:

| Role | Floor | Order | Settle | Transfer/Merge/Split | Kitchen KDS | Settings |
|------|-------|-------|--------|----------------------|-------------|----------|
| **waiter** | ✓ | ✓ own tables | ✓ | — | view | — |
| **cashier** | view | ✓ | ✓ | ✓ | — | — |
| **manager** | ✓ | ✓ | ✓ | ✓ | ✓ | partial |
| **owner** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

New permissions: `hospitality.floor`, `hospitality.order`, `hospitality.settle`, `hospitality.transfer`, `hospitality.kitchen`.

Waiter rule: only assigned waiter (or manager/owner) can modify an open table when `allowWaiterTableLock` is on.

### 1.6 Indexes

```sql
create index dining_tables_shop_status_idx on public.dining_tables (shop_id, display_status);
create index table_sessions_shop_open_idx on public.table_sessions (shop_id, status) where status in ('open', 'payment_pending');
create index sales_draft_hospitality_idx on public.sales (shop_id, updated_at desc) where status = 'draft';
create index kitchen_tickets_station_status_idx on public.kitchen_tickets (station_id, status, fired_at desc);
```

### 1.7 RPCs (Supabase)

| RPC | Purpose |
|-----|---------|
| `shop_push_pending_sale` | Upsert draft sale + lines (from Pending Sales design) |
| `shop_push_table_session` | Upsert session + link sale |
| `shop_transfer_table_session` | Move session to new table_id, log event |
| `shop_merge_table_sessions` | Merge source → target session/sale |
| `shop_push_kitchen_ticket` | Fire ticket + items |
| `shop_update_kitchen_ticket_status` | KDS bump queued → ready |
| `shop_push_sale_complete` | Draft → completed (settle bill) |
| `shop_cancel_pending_sale` | Cancel open table without payment |

All RPCs: **idempotent**, shop-scoped, RLS via `shop_members`.

---

## 2. Table architecture (system layers)

```
┌─────────────────────────────────────────────────────────────────┐
│                        PRESENTATION                              │
│  FloorPlanPage │ TableOrderPage │ KitchenDisplay │ SettleSheet  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                     HOSPITALITY STORE                            │
│  useHospitalityStore (or extend usePosStore)                       │
│  - areas[], tables[], sessions[], activeSessionId                │
│  - openTable(), addLines(), fireTicket(), settle(), transfer()   │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                     DOMAIN SERVICES                              │
│  tableSessionService │ kitchenRoutingService │ billSplitService  │
│  floorStatusService  │ waiterAssignmentService                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│              EXISTING POS CORE (unchanged contracts)             │
│  usePosStore.sales[] │ draftCart │ finalizeDraftSale            │
│  products │ stock │ payments │ receipts │ shifts                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                   OFFLINE PERSISTENCE                            │
│  IndexedDB entityStore: dining_areas, dining_tables,             │
│  table_sessions, kitchen_tickets + existing sales/products       │
│  syncQueue: pending_table_sessions, pending_kitchen_tickets      │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                      SUPABASE CLOUD                              │
│  PostgreSQL tables + RPCs + incremental pull + cloud snapshot    │
└─────────────────────────────────────────────────────────────────┘
```

### Client types (TypeScript)

```typescript
type TableDisplayStatus = 'available' | 'occupied' | 'payment_pending' | 'reserved' | 'disabled';

type DiningArea = { id: string; shopId: string; name: string; sortOrder: number; isActive: boolean };
type DiningTable = {
  id: string; areaId: string; label: string; capacity?: number;
  displayStatus: TableDisplayStatus; sortOrder: number;
  activeSessionId?: string | null;
};
type TableSession = {
  id: string; tableId: string; saleId: string;
  guestCount: number; customerName?: string; customerPhone?: string;
  waiterStaffId?: string; waiterLabel?: string;
  status: 'open' | 'payment_pending' | 'closed' | 'cancelled' | 'merged';
  openedAt: string; closedAt?: string;
  pendingSync: boolean;
};
```

### Table status derivation

| Colour | Status | Rule |
|--------|--------|------|
| 🟢 Green | Available | No open session; table active |
| 🟠 Orange | Occupied | Session `open`, draft sale has lines or guest count set |
| 🔴 Red | Payment Pending | Session `payment_pending` OR user tapped "Request Bill" |
| 🔵 Blue | Reserved | Upcoming reservation within window (v2) |
| ⚫ Gray | Disabled | `is_active = false` |

Running total on floor tile = `draftSale.totalUgx` for linked session.

---

## 3. UI wireframes

Mobile-first. Minimum tap target **48px**; floor tiles **72px+**.

### 3.1 Navigation (Hospitality Mode)

Bottom nav replaces **Sell** with **Floor** when `isHospitalityMode()`:

```
[ Home ]  [ Floor ]  [ Kitchen* ]  [ Office ]
              ↑           ↑
         primary      if role permits
```

Retail shops keep `[ Sell ]`. Quick takeaway still available via **Takeaway** chip on Floor header.

### 3.2 Floor plan — `/floor`

```
┌──────────────────────────────────────────────┐
│  Floor Plan          Takeaway   All UGX 234k│
├──────────────────────────────────────────────┤
│  [ Main Hall ] [ Veranda ] [ VIP ] [ + Area ]│
├──────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ Table 1 │  │ Table 2 │  │ Table 3 │       │
│  │  GREEN  │  │ ORANGE  │  │  RED    │       │
│  │         │  │ 45,000  │  │ 87,000  │       │
│  └─────────┘  └─────────┘  └─────────┘       │
│  ┌─────────┐  ┌─────────┐                    │
│  │ Table 4 │  │ Table 5 │   ← scroll grid    │
│  │ ORANGE  │  │  BLUE   │                    │
│  │ 12,000  │  │Reserved │                    │
│  └─────────┘  └─────────┘                    │
├──────────────────────────────────────────────┤
│  Legend: ● Free ● Busy ● Bill ● Reserved     │
└──────────────────────────────────────────────┘
```

Tap **occupied/red** table → Table Order screen.  
Tap **green** → Open Table sheet.  
Long-press → Transfer / Merge / Disable (manager+).

### 3.3 Open table sheet

```
┌──────────────────────────────────────────────┐
│  Open Table 5 · VIP                      ✕   │
├──────────────────────────────────────────────┤
│  Number of guests                            │
│  [ 1 ] [ 2 ] [ 3 ] [ 4 ] [ 5 ] [ 6+ ]        │
├──────────────────────────────────────────────┤
│  Customer name (optional)                    │
│  [________________________]                  │
│  Phone (optional)                            │
│  [ +256 __________ ]                         │
├──────────────────────────────────────────────┤
│  Waiter: Denis ▼                             │
├──────────────────────────────────────────────┤
│            [ OPEN TABLE ]                    │
└──────────────────────────────────────────────┘
```

### 3.4 Table order screen — `/floor/:sessionId`

```
┌──────────────────────────────────────────────┐
│  ← Table 5 · VIP          ⋮ Transfer Merge   │
├──────────────────────────────────────────────┤
│  4 Guests · Waiter: Denis · Open 45 min      │
├──────────────────────────────────────────────┤
│ [Beer][Wine][Spirits][Food][Pork][Chicken]…  │
├──────────────────────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐                   │
│  │ Bell │ │ Nile │ │ Pork │  product grid      │
│  │Lager │ │ Spec │ │Plate │                   │
│  └──────┘ └──────┘ └──────┘                   │
├──────────────────────────────────────────────┤
│  RUNNING BILL                          87,000│
│  2× Bell Lager                      10,000   │
│  3× Nile Special                    15,000   │
│  1× Pork Plate                      25,000   │
│  2× Bell Lager (14:40)              10,000   │
│  1× Goat Plate (15:02)              27,000   │
├──────────────────────────────────────────────┤
│ [ + Add note ]              [ Send to kitchen]│
│ [ Save bill ]  [ Request bill ]  [ SETTLE → ] │
└──────────────────────────────────────────────┘
```

- **Save bill** = persist draft (auto on each add in v1; explicit for slow networks)
- **Request bill** → table turns **red** (payment pending)
- **Settle** → existing payment sheet (cash, MoMo, card, mixed)

### 3.5 Settle bill sheet

```
┌──────────────────────────────────────────────┐
│  Settle · Table 5                       ✕    │
├──────────────────────────────────────────────┤
│  TOTAL                              UGX 87,000│
├──────────────────────────────────────────────┤
│  [ Split bill ]                              │
├──────────────────────────────────────────────┤
│  Payment                                     │
│  ○ Cash  ○ MTN MoMo  ○ Airtel  ○ Card        │
│  ○ Mixed                                     │
│                                              │
│  Cash:     [ 50,000 ]                        │
│  MoMo ref: [ TXN123   ]                      │
├──────────────────────────────────────────────┤
│  [ Print receipt ]     [ COMPLETE PAYMENT ]  │
└──────────────────────────────────────────────┘
```

### 3.6 Split bill sheet

```
┌──────────────────────────────────────────────┐
│  Split bill · UGX 100,000               ✕    │
├──────────────────────────────────────────────┤
│  [ Equal split ] [ Custom ] [ By item ]      │
├──────────────────────────────────────────────┤
│  Customer A                         40,000   │
│  Customer B                         60,000   │
│  [ + Add person ]                            │
├──────────────────────────────────────────────┤
│  Settle each separately or one pays rest     │
│            [ APPLY SPLIT ]                   │
└──────────────────────────────────────────────┘
```

**Equal:** divide total by N. **Custom:** owner enters amounts (must sum to total). **By item:** tap lines to assign to person A/B/C.

### 3.7 Kitchen display — `/kitchen`

```
┌──────────────────────────────────────────────┐
│  Kitchen · Main            3 waiting         │
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐│
│ │ TABLE 5 · VIP · 14:22 · Denis             ││
│ │ 1× Goat Plate                             ││
│ │ 2× Rice                                   ││
│ │ 1× Chicken                                ││
│ │        [ PREPARING ]  [ READY ✓ ]         ││
│ └──────────────────────────────────────────┘│
│ ┌──────────────────────────────────────────┐│
│ │ TABLE 2 · Veranda · 14:18                 ││
│ │ ...                                       ││
│ └──────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

Bar station uses same component filtered by `station_type = 'bar'`.

### 3.8 Settings — Floor setup — `/settings/floor`

```
Areas & Tables
├── Main Hall (4 tables)          [ Edit ]
├──
├── Veranda (6 tables)            [ Edit ]
└── [ + Add area ]

Kitchen stations
├── Main Kitchen                  [ Edit ]
├── Bar                           [ Edit ]
└── [ + Add station ]

Product routing: assign category/product → station
```

---

## 4. Waiter workflow

```mermaid
sequenceDiagram
  participant W as Waiter
  participant F as Floor Plan
  participant O as Table Order
  participant K as Kitchen/Bar
  participant P as Payment

  W->>F: Tap free table (green)
  F->>W: Open table sheet (guests, name, phone)
  W->>F: Confirm Open Table
  F->>O: Navigate to order screen
  W->>O: Add items (beer, food)
  O->>K: Auto-fire ticket by product routing
  Note over O: Bill stays draft — no revenue yet
  W->>O: Customer orders more (20 min later)
  W->>O: Add more items → same bill grows
  W->>O: Request bill (optional)
  Wrote Red on floor
  W->>P: Settle bill
  P->>P: Complete sale (stock ↓ revenue ↑)
  P->>F: Table green again
```

### Day-in-the-life (Ugandan bar)

1. **Shift start** — Denis logs in with PIN (`waiter` role). Shift links to `ShiftRecord`.
2. **Peak hour** — Denis opens Table 3 (Veranda), 4 guests, adds 6 Nile Special. Bar ticket prints automatically.
3. **Parallel tables** — Denis opens Table 7; another waiter opens Table 1. Each sees only their tables highlighted (filter toggle).
4. **Group join** — Manager merges Table 5 + Table 6 → Table 5 for a birthday group.
5. **Move customer** — VIP opens up; Denis transfers Table 3 → VIP Table 8 (entire bill moves).
6. **Split bill** — Two friends pay separately: custom split UGX 40k + UGX 60k; two settle flows, one parent session closes when all splits paid.
7. **Shift end** — Denis closes shift; report shows tables served, revenue handled, MoMo vs cash.

### Waiter assignment rules

- On open: default to logged-in staff.
- Manager can reassign from table menu.
- If `allowWaiterTableLock`: other waiters see table as read-only with badge "Denis".
- Owner always has override.

---

## 5. Kitchen & bar workflow

### Routing logic

```typescript
function routeLineToStation(product: Product, stations: KitchenStation[]): KitchenStation | null {
  const h = product.metadata?.hospitality;
  if (h?.stationId) return stations.find(s => s.id === h.stationId) ?? null;
  if (h?.isDrink) return stations.find(s => s.stationType === 'bar') ?? null;
  if (h?.isFood) return stations.find(s => s.stationType === 'kitchen') ?? null;
  // Fallback: category keyword
  if (/beer|wine|spirit|cocktail|soda/i.test(product.category)) return barStation;
  if (/food|chicken|pork|fish|rice|goat/i.test(product.category)) return kitchenStation;
  return null;
}
```

### Fire policy

| Setting | Behaviour |
|---------|-----------|
| `autoFireKitchen: true` | Food lines fire immediately on add |
| `autoFireBar: true` | Drink lines fire immediately on add |
| Manual mode | Waiter taps **Send to kitchen** to batch-fire new lines |

Only **new or increased quantities** since last fire create ticket items (dedupe by line version).

### Print template (58mm thermal)

```
================================
        MAIN KITCHEN
================================
TABLE 5          VIP
14:22            Denis
--------------------------------
1x Goat Plate
2x Rice
1x Chicken
--------------------------------
        ** NEW ORDER **
================================
```

Bar ticket: same header with **BAR** and drink lines only.

### KDS states

`queued` → `preparing` → `ready` → `served`

- Kitchen taps **Ready** → optional waiter notification (v2)
- **Served** auto when table settles or manual bump

Offline: tickets queue locally; print uses Web Bluetooth / Android print bridge if configured; otherwise on-screen KDS only.

---

## 6. Sync strategy

### 6.1 Offline-first (non-negotiable)

All hospitality operations work with **no internet**:

- Open table, add items, fire tickets, transfer, merge, settle (cash)
- IndexedDB holds full floor state per `accountKey`
- Sync queue drains when online

### 6.2 Entity sync map

| Entity | Local store | Queue kind | RPC |
|--------|-------------|------------|-----|
| Draft sale (bill) | `sales[]` status=pending | `pending_sales` | `shop_push_pending_sale` |
| Table session | `table_sessions` entity | `pending_table_sessions` | `shop_push_table_session` |
| Kitchen ticket | `kitchen_tickets` entity | `pending_kitchen_tickets` | `shop_push_kitchen_ticket` |
| Completed sale | `sales[]` status=completed | `pending_sales` | `shop_push_sale_complete` |
| Floor layout | `dining_areas`, `dining_tables` | `pending_floor_layout` | upsert batch |

Included in **cloud snapshot** (`shop_cloud_snapshots`) for full-device restore.

### 6.3 Multi-device conflict rules

| Scenario | Resolution |
|----------|------------|
| Two waiters add to same table offline | Merge line items by `updated_at`; last writer wins per line id |
| Device A settles, Device B adds item | Server rejects line push on completed sale; client refreshes session |
| Transfer on two devices | First `shop_transfer_table_session` wins; second gets error + refresh |
| Ticket status bump | Monotonic status progression; `ready` beats `queued` |

### 6.4 Pull filter (incremental)

Extend cloud pull `since` cursor to include:

- `sales` where `status in ('draft', 'cancelled')` and `metadata->>'hospitality' = 'true'`
- `table_sessions`, `kitchen_tickets`, `dining_tables` by `updated_at`

Floor plan poll interval on active Floor screen: **15s when online** (lightweight); full sync on app foreground.

### 6.5 Revenue & stock sync (unchanged)

- Draft bills: **no stock movement**, **no revenue**
- Settle: `shop_push_sale_complete` → stock trigger fires once
- Matches Pending Sales design — hospitality is a **specialized UX** over the same sale lifecycle

---

## 7. Reporting design

### 7.1 Rules

All monetary reports use **`status = 'completed'` only**. Open tables appear in operational views, not revenue.

### 7.2 New reports (Hospitality section in Reports)

| Report | Source | Notes |
|--------|--------|-------|
| **Top selling foods** | Completed sale lines where `isFood` | Filter by date range |
| **Top selling drinks** | Completed lines where `isDrink` | Beer vs spirits breakdown |
| **Most active waiters** | `soldByUserId` / `waiter_label` on sessions | Tables served, revenue, avg ticket |
| **Table revenue** | Group completed sales by `table_id` | Which tables earn most |
| **Daily revenue** | Existing report | Unchanged filter |
| **Daily profit** | Existing report | Unchanged filter |
| **Peak hours** | `completed_at` hour histogram | Lunch vs evening bar peak |
| **Average table time** | `closed_at - opened_at` on sessions | Turnover metric |
| **Open tables now** | Draft sales + sessions | Operational card, not revenue |

### 7.3 Dashboard card (Home)

```
┌─────────────────────────────────┐
│  Floor now                      │
│  8 tables open · UGX 456,000    │
│  pending (not in today's sales) │
│  [ View floor ]                 │
└─────────────────────────────────┘
```

### 7.4 Shift report extension

Add to `ShiftRecord` close summary:

- Tables opened / closed
- Food sales vs drink sales
- MoMo vs cash (existing)

### 7.5 Server RPCs

`shop_hospitality_report(p_shop_id, p_from, p_to, p_report)` — aggregates on server for owner dashboard when online; client computes same from local data offline.

---

## 8. Migration strategy

### Phase 0 — Prerequisites (already designed)

1. Ship **Pending Sales** ([PENDING_SALES_DESIGN.md](./PENDING_SALES_DESIGN.md)) — draft sale lifecycle, sync RPCs, report guards.
2. Verify `finalizeDraftSale` only decrements stock on complete.

### Phase 1 — Schema & types (1 migration batch)

**Migration `072_hospitality_business_types.sql`**

- Add `bar`, `restaurant_bar`, `hotel` to business_type checks
- Create `dining_areas`, `dining_tables`, `table_sessions`, `kitchen_stations`, `kitchen_tickets`, `kitchen_ticket_items`, `table_session_events`
- Extend `sales` columns
- RLS policies mirroring `products` / `sales` shop scoping
- Seed RPCs

**Client:**

- Extend `BusinessType`, `businessTypes.ts`, onboarding cards
- `isHospitalityMode()` helper
- Category presets: `src/data/hospitalityCategoryPresets.ts`

### Phase 2 — Floor & table CRUD

1. Settings UI: areas, tables, stations
2. Default layout wizard on first hospitality onboarding ("How many tables in main area?")
3. Entity store + sync for floor layout
4. No ordering yet — layout only

### Phase 3 — Core table service (MVP)

1. Floor plan with status colours
2. Open table → draft sale + session
3. Table order screen (reuse PosPage product grid + category shelf)
4. Running bill accumulation
5. Settle bill → complete sale
6. Table summary totals on floor tiles

**Pilot:** 1 pork joint + 1 bar in Kampala.

### Phase 4 — Kitchen & bar

1. Product routing metadata
2. Auto-fire tickets
3. Kitchen display route `/kitchen`
4. Print integration (Android BT printer)

### Phase 5 — Advanced operations

1. Transfer table
2. Merge tables
3. Split bill (equal + custom first; by-item in 5b)
4. Waiter role + assignment lock
5. Payment pending (red) state

### Phase 6 — Reporting & polish

1. Hospitality reports
2. Waiter shift stats
3. i18n EN + LG
4. Reservations (optional module)

### Phase 7 — Hotel extensions (future)

- Room charge linkage
- Guest house breakfast tabs
- Multi-outlet (restaurant + bar as separate area groups)

### Rollout & rollback

```typescript
// Shop setting — kill switch per venue
preferences.hospitalityModeEnabled?: boolean; // default true when business type qualifies
```

- **Rollback:** disable flag → app falls back to Pending Sales + retail Sell screen; floor data remains in DB harmless
- **Existing restaurant shops:** migration auto-creates one area "Main Hall" with numbered tables 1–10 if none configured; owner edits in Settings
- **Existing sales:** unchanged; all historical rows `status = completed`

### Data migration for current `restaurant` shops

```sql
-- Backfill default floor for hospitality shops without layout
insert into dining_areas (shop_id, name, sort_order)
select id, 'Main Hall', 0 from shops
where business_type in ('restaurant', 'bar', 'restaurant_bar', 'hotel')
and not exists (select 1 from dining_areas da where da.shop_id = shops.id);
```

---

## 9. Product categories (hospitality presets)

Owner-customizable; suggested defaults:

**Bar:** Beer, Wine, Spirits, Soft Drinks, Water, Cocktails, Snacks  
**Restaurant:** Food, Chicken, Pork, Fish, Goat, Rice, Chips, Desserts, Coffee, Soft Drinks, Water  
**Restaurant & Bar:** Union of both  
**Hotel:** Above + Breakfast, Room Service (stub)

Stored as today (`Product.category` string + shelf chips). Future: link `product_categories` FK.

---

## 10. Implementation checklist

| Area | Key files / artifacts |
|------|------------------------|
| DB | `072_hospitality_*.sql`, RPCs |
| Types | `src/types.ts`, `src/lib/hospitality.ts` |
| Store | `usePosStore` or `useHospitalityStore` |
| Pages | `FloorPlanPage`, `TableOrderPage`, `KitchenDisplayPage` |
| Settings | `FloorSetupPage`, station routing |
| Sync | `cloudSync.ts`, `entityStore.ts` queue kinds |
| Permissions | `permissions.ts` — waiter role |
| Reports | `localReporting.ts`, `ReportsPage` hospitality section |
| i18n | `hospitality_*` keys EN/LG |
| Printing | `src/lib/kitchenPrint.ts` |
| Tests | open → order → fire → settle; offline queue; merge; split |

---

## 11. Why this fits Uganda

- **Pay later is normal** — groups drink for hours before settling; bill accumulates on one tab.
- **Split bills are daily** — custom amounts match "you pay for the pork, I pay for the beers."
- **MoMo + cash mixed** — existing mixed payment flow reused at settle.
- **Power and network fail** — offline-first floor never blocks service.
- **Simple language** — "Open table", "Running bill", "Settle bill" not "check", "cover", "guest check."
- **Pork joints & local bars** — category presets and bar/kitchen split match how venues actually staff operations.
- **No foreign complexity** — no mandatory courses, covers, or service charge unless owner enables later.

---

## 12. Relationship to Pending Sales

| Concept | Pending Sales (retail) | Hospitality Mode |
|---------|------------------------|------------------|
| Held bill | Draft sale + reference label | Draft sale + table session |
| List UI | Pending Sales list | Floor plan tiles |
| Identifier | "Table 5" free text | Structured table + area |
| Kitchen | — | Station tickets |
| Revenue timing | On complete | On settle (same) |

Hospitality Mode **does not replace** Pending Sales — takeaway and retail counter in the same venue can still use Pending Sales or instant Sell.

---

## 13. Open decisions (for sign-off)

1. **Stock reservation v2** — warn if item is on another open table? (v1: no reservation)
2. **Auto-save** — every line add persists draft immediately vs explicit Save bill
3. **Hotel room charge** — phase 7 or stub in phase 1?
4. **Receipt numbering** — assign receipt seq on settle only (recommended)
5. **Split bill v1 scope** — equal + custom only first?

---

*Document version: 1.0 · May 2026 · Waka POS Hospitality Mode*
