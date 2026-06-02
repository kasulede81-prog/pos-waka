# Multi-device inventory sync

## Authoritative stock

Cloud `products.stock_on_hand` is updated only through the **inventory movement ledger** (`inventory_movements` + RPCs). Client devices must not treat local `updatedAt` as stock truth after sync.

## Sale completion flow

```
finalizeDraftSale()
  → local stock -= qty (UX + offline)
  → local StockMovement rows (stable id: sale + product)
  → queueRemote("pending_sales", { saleId })

flushSyncQueue()
  → pushSaleToCloud()
  → shop_push_sale_complete (Postgres)
       → upsert sale + lines
       → mark completed
       → apply_sale_stock_movements(sale_id)  [idempotent]
  → response product_stocks[]
  → patchProductsWithServerStock() on device
```

### Idempotency

- Server: one movement per `(shop_id, sale_id, product_id)` via unique index + existence check.
- Movement UUID: `inventory_movement_uuid(shop, 'sale', sale_id, product_id)` (UUID v5).
- Re-syncing the same sale never deducts twice.

## Other movement sources

| Action | Client | Server |
|--------|--------|--------|
| Sale | `pending_sales` → `apply_sale_stock_movements` | Migration 083 |
| Void | `pending_stock_updates` (+qty) | `shop_push_product_stock` |
| Return | `pending_returns` | `apply_sale_return_stock` |
| Purchase | `pending_purchases` + stock delta | `shop_push_purchase` + stock RPC |
| Adjust | `pending_stock_updates` | `shop_push_product_stock` |

## Cloud pull merge

`pullCloudAndMergeIntoStore` uses `mergeProductFromCloudPull`:

- **stock_on_hand**: always from cloud row
- **price/cost**: higher `version` wins; other catalog fields use newer `updatedAt`

## Integrity check (client)

`verifyInventoryIntegrity({ products, movements, openingStockByProduct })` compares recorded stock to `opening + Σ(movement deltas)` for products with movement history.

## Migrations

- `082_inventory_integrity.sql` — idempotent `apply_sale_stock_movements`, sale RPC without pre-stock overwrite
- `083_sale_stock_sync.sql` — wires movements into `shop_push_sale_complete`, stable movement UUIDs, returns `product_stocks`
- `084_remediate_sale_inventory_movement_duplicates.sql` — removes duplicate sale movements (keeps oldest), corrects stock, adds unique index

## Deploy

Apply on Supabase in order: **082** → **083** → **084**.

If **083** failed on `inventory_movements_sale_product_unique` (error 23505), run **084** only; it dedupes then creates the index.

### Verify zero duplicates (expect no rows)

```sql
select shop_id, reference_type, reference_id, product_id, count(*) as duplicate_rows
from public.inventory_movements
where reference_type = 'sale' and reference_id is not null
group by shop_id, reference_type, reference_id, product_id
having count(*) > 1;
```
