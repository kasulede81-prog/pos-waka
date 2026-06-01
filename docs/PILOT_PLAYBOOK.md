# Waka POS — Pilot Playbook

Operational guide for onboarding 5–10 real pilot shops. No new features during pilot — focus on evidence collection.

## Who this is for

- **Shop owner** — daily use, close day, backups, support
- **Waka field / support** — onboarding, migration, troubleshooting
- **Internal admin** — cohort health via **Internal → Pilot** tab

---

## 1. Onboard a new shop

### Before visit

1. Confirm Supabase migrations **070–078** applied (see `docs/PILOT_RELEASE_CHECKLIST.md`).
2. Create or verify owner account (email + phone).
3. Assign subscription / activation key if required.
4. Note business type (kiosk, pharmacy, bar, restaurant, etc.) — migration **078** preserves type in cloud.

### On device (30–45 min)

1. Install **Android APK** or open **PWA** and “Add to Home Screen”.
2. Owner signs in → complete **Shop onboarding** (business type, district, phone, starter products).
3. **Settings → Shop** — verify shop name, receipt header, support phone.
4. **Settings → PIN** — set back-office PIN (required for debts, customers, cash expenses).
5. **Settings → Backup** — run manual backup once; confirm file downloads.
6. **Settings → Pilot mode** (owner only) — enable for diagnostics during pilot.
7. Sell 2–3 test transactions; confirm receipt prints or shares.
8. Force sync: **Office → Backup & sync → Full sync**; pending count should reach 0.

### Handoff script (owner)

> “Sales work offline. Green sync means cloud is up to date. Close day every evening. If something breaks, open Support center under Settings — copy diagnostics and WhatsApp us.”

---

## 2. Migrate from notebook to Waka

### Inventory

1. List top 50–100 SKUs by revenue (notebook or shelf walk).
2. For each: name, sell price, cost (if known), approximate qty.
3. Use **Stock → Add product** or bulk import if available.
4. Enable **Pilot mode** → check sync health after bulk adds.

### Opening balances

- **Cash drawer:** record as opening float on first shift / close day (not historical sales).
- **Customer debts:** **Customers → Add customer → Record debt** for known balances only; do not backfill years of history in v1 pilot.
- **Suppliers:** optional; add if owner tracks payables.

### Parallel run (recommended week 1)

- Keep notebook as backup; enter every sale in Waka.
- End of day: compare notebook total vs Waka **Close day** revenue.
- Discrepancies > 2% → pause expansion, open support ticket with diagnostics.

### Cutover

- After 5 consecutive days within 2%: notebook becomes reference only.
- Export backup JSON before cutover day.

---

## 3. Day close (owner)

1. **Office → Close day** (or nav equivalent).
2. Count physical cash in drawer.
3. Enter counted cash; review expected vs actual (includes debt payments collected today).
4. Confirm close — creates audit trail and pilot event log entry.
5. Optional: screenshot summary for owner records.
6. Ensure sync completes (Pilot mode shows verbose sync in console; **Sync health** card shows last success).

**Cadence:** once per calendar day per register. Multi-register shops: close each register separately (pilot cohort should prefer single register).

---

## 4. Restore from backup

### When to restore

- New phone/tablet
- Corrupted local data (rare)
- Owner cleared app storage by mistake

### Steps

1. Sign in as **same owner account**.
2. **Settings → Backup & sync → Restore** (or Backup settings card).
3. Choose latest **manual backup** or cloud snapshot if prompted.
4. Wait for restore to finish — do not force-close app.
5. Verify product count and today’s sales list.
6. Run **Full sync** after restore.

### If restore fails

- Enable **Pilot mode** → **Support center** → export diagnostics JSON.
- Contact support with backup file + diagnostics (WhatsApp preferred).

Pilot event log records `restore` locally for support.

---

## 5. Contact support

### Owner (< 30 seconds)

1. **Settings → Support center** (or tap banner when Pilot mode on).
2. Describe issue in one sentence.
3. Tap **Copy diagnostics** or **Download JSON**.
4. Tap **Report via WhatsApp** — paste if clipboard did not auto-fill.
5. Attach screenshot if relevant (optional file picker).

Included automatically: app version, shop ID, device ID, role, plan, sync queue, recent pilot events.

### Waka support channels

- WhatsApp: in-app Support center button (canonical number in `src/config/company.ts`)
- Email: support addresses from same config
- Internal: **Internal admin → Support** for tickets; **Pilot** tab for cohort KPIs

### Escalation data to request

- Diagnostics JSON
- Approximate time of issue (pilot event log shows local timeline)
- Screenshot of error screen
- Whether issue is device-specific or shop-wide

---

## Pilot cohort rules

| Rule | Why |
|------|-----|
| 5–10 shops max initially | Support capacity |
| Single register preferred | Avoid multi-device debt/sync edge cases |
| Owner-supervised first 2 weeks | Training + trust |
| Pilot mode on for owners | Faster troubleshooting |
| No custom features during pilot | Evidence before build |

## Success signals (4–6 weeks)

- Sync error rate < 5% of devices
- Zero unresolved data-loss reports
- Day close matches cash within owner tolerance
- Owners use app 6+ days/week without workaround notebook

## Known limitations (communicate upfront)

- Multi-device same shop: debt and pending sales need careful use (pilot = single device).
- Crash rate monitored via Sentry, not in-app dashboard.
- Hospitality/pharmacy modes: only shops trained for those verticals.
