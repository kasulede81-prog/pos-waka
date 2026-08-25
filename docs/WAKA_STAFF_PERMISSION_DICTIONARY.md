# WAKA Staff — Business Permission Dictionary

**Phase 5b.** Translation layer only.  
Runtime source of truth remains `Permission` codes in `src/types.ts` + `ROLE_PERMISSIONS` in `src/lib/permissions.ts`.

Check access with:

```ts
import { can } from "../features/staff/roles";

can(actor, "sale.refund");   // → sale_void
can(actor, "staff.manage");  // → settings.shop
can(actor, "refund_sale");   // legacy alias → sale_void
```

Do **not** rename stored Permission codes or custom-role snapshots.

---

## How to read this table

| Column | Meaning |
|---|---|
| **Business action** | Owner / developer-friendly id (`StaffAction`) |
| **Owner sees** | Roles Center label intent |
| **Engine code** | Existing `Permission` (unchanged) |
| **Example** | Where it shows up in the product |

---

## Sales

| Business action | Owner sees | Engine code | Example |
|---|---|---|---|
| `sale.create` | Sell products | `pos.sell` | Complete a cart / checkout |
| `sale.void` | Void or refund sales | `sale_void` | Void a line on a receipt |
| `sale.refund` | Refund or return a sale | `sale_void` | Same engine gate as void today |
| `sale.discount` | Apply discounts while selling | `pos.sell` | Cart discount (no separate Permission yet) |
| `sale.hold` | Hold or park a sale | `pending_sales.manage` | Pending / table hold |
| `receipt.view` | View receipts | `receipts.view` | Receipts list / reprint |

**Legacy aliases:** `sell`, `create_sale` → `pos.sell`; `refund_sale`, `void_sale` → `sale_void`.

---

## Inventory

| Business action | Owner sees | Engine code | Example |
|---|---|---|---|
| `inventory.view` | View stock | `stock.view` | Stock list |
| `inventory.adjust` | Adjust stock | `stock.adjust` | Manual qty change |
| `inventory.count` | Stock counts | `stock.count` | Count sessions |
| `product.add` | Add products | `products.add` | New product |
| `product.edit` | Edit products | `products.edit_presets` | Edit product / presets |
| `product.remove` | Delete products | `products.remove` | Remove product |
| `inventory.purchase` | Record purchases | `purchases.record` | Stock-in / PO |

---

## Customers

| Business action | Owner sees | Engine code | Example |
|---|---|---|---|
| `customer.view` | View customers | `customers.view` | Customer list |
| `customer.credit` | Manage customer debt | `customers.debt` | Credit / debt payment |

---

## Suppliers

| Business action | Owner sees | Engine code | Example |
|---|---|---|---|
| `supplier.view` | View suppliers | `suppliers.view` | Supplier list |
| `supplier.manage` | Manage suppliers | `suppliers.manage` | Edit supplier / pay |

---

## Staff

| Business action | Owner sees | Engine code | Example |
|---|---|---|---|
| `staff.view` | Manage staff and shop settings | `settings.shop` | *Not split yet* — same as manage |
| `staff.invite` | Manage staff and shop settings | `settings.shop` | Invite email (same gate today) |
| `staff.manage` | Manage staff and shop settings | `settings.shop` | Staff Center, add/disable, reset PIN |

**Legacy:** `manage_staff` → `settings.shop`.

> Future (not in 5b): split `settings.shop` into `staff.*` vs `shop.settings`. Until then, staff.* and shop.settings share the same engine code when they both map to `settings.shop`.

---

## Shop

| Business action | Owner sees | Engine code | Example |
|---|---|---|---|
| `shop.settings` | Manage staff and shop settings | `settings.shop` | Shop profile / many settings routes |
| `shop.receipt_settings` | Receipt settings | `settings.receipt` | Receipt branding |
| `shop.devices` | Device management | `settings.devices` | Devices page |

**Legacy:** `manage_shop_settings` → `settings.shop`.

---

## Reports

| Business action | Owner sees | Engine code | Example |
|---|---|---|---|
| `report.view` | View reports | `reports.view` | Reports hub |
| `report.profit` | View profit reports | `reports.profit` | Margin / profit |

**Legacy:** `view_reports`, `view_profit`.

---

## Access

| Business action | Owner sees | Engine code | Example |
|---|---|---|---|
| `backoffice.enter` | Back office access | `back_office.access` | Enter Back Office shell |

**Legacy:** `access_back_office`.

---

## Important engine notes (unchanged)

1. **Void vs refund** — one Permission (`sale_void`) today; business names `sale.void` and `sale.refund` both map there.
2. **`settings.shop` is broad** — Staff Center + many shop admin routes; staff.* / shop.settings aliases are intentional until a future split.
3. **Plan entitlements** — still use `actorHasEffectivePermission`; `can()` is role/snapshot only.
4. **Custom roles** — still store raw `Permission` codes; Roles Center shows owner labels via `permissionLabel()`.

---

## Related files

| File | Role |
|---|---|
| `src/features/staff/roles/can.ts` | `StaffAction` + `STAFF_ACTION_TO_PERMISSION` + `can()` |
| `src/lib/permissions.ts` | Matrix (do not change in 5b) |
| `src/lib/enterpriseRoles/permissionLabels.ts` | Maps Permission → i18n label key |
| `docs/WAKA_STAFF_SIMPLE_MODEL.md` | Staff lifecycle / operator vs seller |
