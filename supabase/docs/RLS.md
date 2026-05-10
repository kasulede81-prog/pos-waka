# Row Level Security (RLS) — Waka POS

This document describes how **tenant isolation** and **role-based access** are enforced in Supabase/PostgreSQL for Waka POS. Policies live in **`migrations/008_row_level_security.sql`**. Security-definer helpers are in **`migrations/007_functions_and_triggers.sql`**.

## Model

- **Organization** (`organizations`): billing and membership anchor. Roles in `organization_members`: `owner`, `admin`, `billing`, `staff`.
- **Shop** (`shops`): POS location under one organization. Roles in `shop_members`: `manager`, `cashier`, `viewer`.
- **Cross-shop visibility**: Org **`owner`** and **`admin`** can access all shops in their org (via `user_can_access_shop` / `user_can_manage_shop` without a `shop_members` row). Other org roles rely on `shop_members` (or explicit org-level rules where stated).

## Helper functions (RLS)

| Function | Purpose |
|----------|---------|
| `user_has_org_role(org_id, roles[])` | True if `auth.uid()` is an org member with one of the given roles. |
| `user_can_access_shop(shop_id)` | Shop member **or** org owner/admin for that shop’s organization. |
| `user_can_manage_shop(shop_id)` | Shop **manager** **or** org owner/admin. |
| `user_is_cashier_or_above(shop_id)` | Shop **cashier** or **manager**, or anyone who can manage the shop (incl. org owner/admin). |

Functions are **`SECURITY DEFINER`** with a fixed `search_path` so policy expressions stay stable.

## Policy summary by table

### `profiles`

- Users may **select/insert/update** only their own row (`id = auth.uid()`).

### `organizations`

- **Select**: membership in `organization_members`, **or** `created_by = auth.uid()` (bootstrap before membership exists).
- **Insert**: `created_by = auth.uid()`.
- **Update**: org `owner` or `admin` only.

### `organization_members`

- **Select**: own membership row, or any row in an org you belong to.
- **Insert**: org `owner`/`admin`, **or** first self row as `owner` (`user_id = auth.uid()` and `role = 'owner'`).
- **Update/Delete**: org `owner`/`admin`.

### `shops`

- **Select**: `user_can_access_shop(id)`.
- **Insert**: org `owner`/`admin`.
- **Update**: `user_can_manage_shop(id)`.
- **Delete**: org `owner`/`admin`.

### `shop_members`

- **Select**: `user_can_access_shop(shop_id)`.
- **Write**: `user_can_manage_shop(shop_id)`.

### Catalog & inventory (`product_categories`, `products`)

- **Select**: `user_can_access_shop(shop_id)`.
- **Write**: `user_can_manage_shop(shop_id)` (managers + org owner/admin).

### `inventory_movements`

- **Select**: `user_can_access_shop(shop_id)`.
- **Insert**: `user_is_cashier_or_above(shop_id)` **or** `user_can_manage_shop(shop_id)` (overlap intentional for clarity).

### `customers`

- **Select**: `user_can_access_shop(shop_id)`.
- **Insert/Update**: cashier or above (`user_is_cashier_or_above`).
- **Delete**: `user_can_manage_shop` (managers + org owner/admin).

### `sales`

- **Select**: shop access.
- **Insert/Update**: cashier or above.

### `sale_line_items`, `sale_payments`

- Scoped through parent `sales`: **select** follows shop access; **insert/update** allows cashiers while the sale is `draft` (or managers for overrides); **delete** on lines typically manager-only (see migration for exact conditions).

### `receipts`

- **Select**: shop access.
- **Insert**: cashier or above (covers trigger-created receipts on sale completion).
- **Update**: `user_can_manage_shop`.

### `shop_counters`

- **All operations**: cashier or above at that shop (so receipt numbering can run when a cashier completes a sale).

### `expenses`

- **Select**: shop access.
- **Write/Update/Delete**: `user_can_manage_shop` (not cashiers).

### `subscription_plans`

- **Select**: authenticated user and `is_active` (catalog is not public).

### `subscriptions`

- **Select**: any org member (`owner`, `admin`, `billing`, `staff`).
- **Insert/Update**: `owner`, `admin`, or `billing` (not generic `staff`).

## Operational notes

- Triggers on `sales` (`007`) create **stock movements**, **receipts**, and touch **counters** under the **session user** completing the sale. Policies must allow that user to pass **insert** checks for `inventory_movements`, `receipts`, and `shop_counters` where applicable.
- **`rpc_inventory_adjust`** and **`rpc_low_stock`** enforce **`user_can_manage_shop`** / shop scope inside the function; grants are limited to `authenticated`; RLS still applies to underlying tables unless the function’s definer bypasses RLS per Postgres rules (prefer using RPC for controlled paths).
- **Service role** (`service_role` key) bypasses RLS — use only on the server and never in the browser.

## Changing policies

After editing policies, re-run or patch in the SQL editor. Prefer `DROP POLICY IF EXISTS …` then `CREATE POLICY` in migrations to keep environments reproducible.
