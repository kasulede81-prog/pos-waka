# Waka POS — Cloud Authority Audit

Classification for zero-data-loss recovery. **A** = recoverable on a new device via cloud pull/snapshot without backup import. **B** = cloud stored but incomplete incremental recovery. **C** = snapshot or local disk required.

| Entity | Class | Incremental pull | Snapshot | New-device recovery |
|--------|-------|------------------|----------|---------------------|
| Products | A | Yes (`products`, paginated) | Yes | Yes — catalog + stock via RPC |
| Sales | A | Yes (`sales`, paginated to 400k safety cap) | Yes (may trim) | Yes — completed sales merge rules |
| Customers | A | Yes (`customers`) | Yes | Yes — debt ledger when payments pulled |
| Debts | A | Yes (payments + sale credit) | Yes | Yes — `customer_debt_payments` |
| Suppliers | A | Yes (`shop_suppliers`) | Yes | Yes — balances recomputed from purchases |
| Purchases | A | Yes (`shop_purchases`) | Yes | Yes — void-aware merge |
| Stock movements | A | Yes (migration 109) | Yes | Yes — `shop_stock_movements` pull/push |
| Inventory counts | A | Yes (migration 108) | Yes | Yes — `shop_inventory_count_sessions` |
| Shifts | A | Yes (migration 108) | Yes | Yes — `shop_shifts` → preferences |
| Day closes | A | Yes (migration 108) | Yes | Yes — `shop_day_closes` |
| Cash adjustments | A | Yes (migration 105) | Yes | Yes — pull RPC |
| Day drawer opens | A | Yes (migration 106) | Yes | Yes — pull RPC + recovery merge |
| Cash expenses | A | Yes (`expenses`) | Yes | Yes |
| Staff | B | Partial (`shop_pos_staff`) | No | Staff RPC — not main entity pull |
| Audit logs | B | Push only | Yes (archived may trim) | Historical via snapshot |
| Reports | C | No | No | Computed from sales — not stored |
| Settings / preferences | B | Partial (shifts in prefs) | Yes | Most prefs snapshot-only |

## Recovery path on new device

1. Login → detect existing shop (`resolvePrimaryOrganizationForUser`)
2. **P0 recovery lock** — POS blocked until `runCloudRecoveryGated()` succeeds
3. If local cache empty → `restoreShopFromCloudSnapshot` then `pullCloudAndMergeIntoStore` (full paginated pull)
4. Validate local state → push pending + upload snapshot only after validation
5. **No backup import required** when A-class entities are synced

## Recovery completeness score (client)

Computed in `src/lib/cloudRecoveryCompleteness.ts` after gated recovery:

| Category | Weight | Source |
|----------|--------|--------|
| Products restored | 20% | Product count vs cloud probe |
| Sales restored | 25% | Sales count; penalized if pull truncated |
| Customers restored | 10% | Customer count |
| Inventory restored | 20% | Products + stock movements + count sessions |
| Operational records | 15% | Shifts, day closes, purchases |
| Historical records | 10% | Archived sales (snapshot-dependent) |

Persisted in recovery diagnostics (`cloudRecoverySession`) and shown in System Health.

## Remaining gaps

- Archived sales / audit logs: not in entity pull — depend on snapshot (8 MB trim may drop)
- Very large shops (>400k sales): safety cap stops pagination — needs ops escalation
- Existing shops: migration 109 must be applied; stock movements backfilled on next sync from devices with local history
- Preferences (receipt, PIN, layout): mostly snapshot

## Recovery score (cloud protection)

Computed in `src/lib/cloudAuthorityAudit.ts` — weighted % of entity types cloud-protected.
