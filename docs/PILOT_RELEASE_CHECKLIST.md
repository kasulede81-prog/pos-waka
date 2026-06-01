# Waka POS — Pilot Release Checklist

Use before shipping build to first 5–10 pilot shops. Complements `docs/PILOT_DEPLOYMENT.md` (updated for migrations 070–078).

---

## Version bump

- [ ] Bump `version` in `package.json` (current: see file)
- [ ] Set `VITE_APP_VERSION` in production env to match (shown in diagnostics export)
- [ ] Tag release in git: `v1.0.x-pilot`
- [ ] Note build date in internal Pilot tab / ops channel

---

## Database migrations (apply in order)

Apply in Supabase SQL editor or `supabase db push`:

- [ ] `070_agent_verification_qr.sql`
- [ ] `071_pending_sales.sql`
- [ ] `072_hospitality_mode.sql`
- [ ] `073_fix_agent_list_all_agents.sql`
- [ ] `074_hospitality_sync.sql`
- [ ] `075_pending_sale_line_merge.sql`
- [ ] `076_scale_hardening.sql`
- [ ] `077_financial_integrity.sql`
- [ ] **`078_business_type_persistence.sql`** (required — fixes business type coercion)

Verify:

```sql
select proname from pg_proc where proname like 'shop_push%' order by 1;
select column_name from information_schema.columns
  where table_name = 'shop_preferences' and column_name like '%business%';
```

---

## Edge functions

```bash
npm run supabase:deploy:admin
```

- [ ] `admin-set-owner-password`
- [ ] `admin-permanently-delete-shop-account`
- [ ] `admin-delete-marketing-agent`

---

## Client build verification

```bash
npm test
npm run build
```

- [ ] All unit tests pass
- [ ] TypeScript build clean
- [ ] `VITE_SENTRY_DSN` set for production
- [ ] `VITE_SUPABASE_URL` + anon key for production project

### Android

```bash
npm run cap:apk:release
# or
npm run cap:bundle:release
```

- [ ] APK installs on target device (Android 10+)
- [ ] Google Play / sideload signing key documented
- [ ] Camera/storage permissions OK for support screenshot picker
- [ ] Back button behavior smoke-tested

### PWA

- [ ] `npm run build` output deployed to production host
- [ ] Service worker registers; offline shell loads
- [ ] “Add to Home Screen” tested on Chrome Android
- [ ] PWA update banner appears after deploy (optional smoke)

### Offline install

- [ ] Airplane mode: open app, complete sale, queue pending
- [ ] Reconnect: pending count → 0 within 30 min
- [ ] Login/logout while offline does not corrupt local DB

---

## Pilot feature smoke (owner account)

- [ ] **Pilot mode** toggle visible only to owner (`Settings`)
- [ ] Pilot banner appears when enabled
- [ ] **Support center** (`/pilot-support`) — copy, download, WhatsApp, email
- [ ] Diagnostics include `appVersion`, `deviceId`, `pilotEvents`
- [ ] Pilot event log records: login, logout, sync failure, day close, void, restore
- [ ] Verbose sync logs in console when pilot mode on

---

## Crash monitoring

- [ ] Sentry test event from staging (`docs/MONITORING.md`)
- [ ] Route errors caught by `RouteErrorBoundary` → Sentry
- [ ] Sync flush errors → `captureAppException` scope `sync_flush`
- [ ] Cloud hydrate errors → scope `cloud_hydrate`
- [ ] Backup restore errors → scope `backup_restore`
- [ ] Onboarding persist errors → scope `onboarding_persist`

---

## Internal admin

- [ ] `/internal/waka/pilot` loads Pilot success dashboard
- [ ] KPIs: shops, active today, online, tickets, sync error rate, avg sales
- [ ] Preview mode works for demos

---

## Pre-launch per shop

- [ ] Owner account + phone verified
- [ ] Business type set correctly (verify in cloud after 078)
- [ ] Manual backup taken and file stored
- [ ] Back-office PIN set
- [ ] Pilot mode enabled
- [ ] Support WhatsApp number saved on owner phone

---

## Rollback

1. **Client:** redeploy previous APK / PWA build (offline sales continue)
2. **Database:** forward-only — do not drop tables; disable RPC grants only in emergency
3. **Pilot cohort:** pause new signups; existing shops stay on last good build

---

## Post-launch weekly (ops)

| Check | Tool | Pass |
|-------|------|------|
| Sync queue | Pilot diagnostics / Internal devices | < 5% error rate |
| Crashes | Sentry | No new critical regressions |
| Support tickets | Internal → Support | SLA < 24h pilot |
| Backups | Owner settings | ≥ 1 manual / 7 days |
| Day close | Owner report + audit | Daily completion |

---

## Release sign-off

| Role | Name | Date |
|------|------|------|
| Engineering | | |
| Ops / field | | |
| Product | | |

**Minimum score to ship:** 85/100 on pilot readiness audit with migrations 076–078 applied.
