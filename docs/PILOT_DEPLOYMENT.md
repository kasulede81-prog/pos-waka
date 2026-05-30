# Waka POS — Pilot Deployment Checklist

Use this checklist before and during a pilot rollout (5–20 shops).

## Pre-deploy

### Migrations (apply in order in Supabase SQL editor or CLI)

- [ ] 057_marketing_agent_roles_and_referrals.sql
- [ ] 058_admin_delete_owner_and_agent_cleanup.sql
- [ ] 059_referral_shop_sync.sql
- [ ] 060_fix_marketing_agent_admin_ops.sql
- [ ] 061_shop_server_reporting.sql
- [ ] **062_sale_returns.sql** (new)
- [ ] **063_shop_push_sale_transactional.sql** (new)
- [ ] **064_reporting_sale_returns.sql** (new)

Verify:

```sql
select to_regclass('public.sale_returns');
select proname from pg_proc where proname in ('shop_push_sale_complete', 'shop_push_sale_return');
```

### Edge functions

```bash
npm run supabase:deploy:admin
```

- [ ] `admin-set-owner-password`
- [ ] `admin-permanently-delete-shop-account`
- [ ] `admin-delete-marketing-agent`

### Client build

- [ ] `npm run build` passes
- [ ] `VITE_SENTRY_DSN` set for production
- [ ] `VITE_APP_VERSION` matches release tag
- [ ] Deploy web build / ship Android APK

## Rollback procedure

1. **Client:** redeploy previous known-good web build or APK (sales continue offline)
2. **Database:** do NOT drop new tables; old clients ignore new RPCs
3. **If RPC causes errors:** revoke grant temporarily:
   ```sql
   revoke execute on function public.shop_push_sale_complete(uuid, jsonb) from authenticated;
   ```
   Then redeploy client that uses legacy multi-step push (only if emergency)
4. **Migrations:** Supabase migrations are forward-only; restore from backup if catastrophic

## Backup verification

Before pilot start, for each shop owner:

- [ ] Export manual backup from Settings → Backup
- [ ] Confirm file opens and contains products/sales
- [ ] Restore to test device in staging (optional)
- [ ] Confirm daily auto-backup date key updates (`lastAutoBackupDateKey`)

## Monitoring verification

- [ ] Sentry project receiving test event (see `docs/MONITORING.md`)
- [ ] `SyncHealthCard` shows last sync time after login
- [ ] Force Full Sync completes without error
- [ ] Pending count returns to 0 after reconnect

## Daily health-check (pilot ops)

| Check | How | Pass criteria |
|-------|-----|---------------|
| Sync queue | SyncHealthCard pending count | 0 after 30 min online |
| Unsynced sales | Diagnostics overlay / `countUnsyncedSales()` | 0 |
| Sentry errors | Sentry dashboard | No new critical issues |
| Stock sanity | Spot-check 3 products vs shelf | Matches within 1 unit |
| Reports | Dashboard daily summary | Loads without error |
| Backups | Owner backup list | ≥1 backup in last 7 days |

## Success criteria (pilot complete)

After **7 consecutive days** per pilot shop:

- [ ] Zero lost sales (local + cloud receipt IDs match)
- [ ] Zero duplicate cloud sales (unique sale UUIDs)
- [ ] Inventory within acceptable drift (<2% SKUs off by >1 unit)
- [ ] No permanent sync blockage (queue always drains)
- [ ] No unhandled crash loops (Sentry)

## Escalation

1. Sync stuck → Force Full Sync → if fail, export backup → support
2. Stock mismatch → compare local vs cloud product row → manual adjust
3. RPC error → check Supabase logs for `shop_push_sale_complete` / `shop_push_sale_return`
