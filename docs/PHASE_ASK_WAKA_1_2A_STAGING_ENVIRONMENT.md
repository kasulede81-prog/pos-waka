# Ask WAKA — Phase ASK-1.2A Staging Environment

**Date:** 2026-08-12  
**Production project (untouched for Ask WAKA deploy/flags):** `ljaedextsenbkxzzgxcg`  
**Staging project:** `wdirxwvbgsfzbdurmkbf` (`waka-pos-staging`, eu-west-1)

---

## A. Staging project reference

| Item | Value |
|------|-------|
| Name | `waka-pos-staging` |
| Ref | `wdirxwvbgsfzbdurmkbf` |
| URL | `https://wdirxwvbgsfzbdurmkbf.supabase.co` |
| Local env | `.env.staging.local` (gitignored) |
| Ops secrets | `.local/waka-pos-staging.env` (gitignored) |
| Test owner | `.local/waka-pos-staging-test-owner.env` (gitignored) |

CLI link restored to production: `ljaedextsenbkxzzgxcg`.

---

## B. Migration status

All repository migrations **001 → 146** applied to staging via:

```bash
supabase link --project-ref wdirxwvbgsfzbdurmkbf
supabase db push --linked --include-all --yes
```

Verified on staging after push:

- `sales` table exists
- `shop_get_daily_sales_summary` exists
- `shop_ai_settings.ask_waka` column exists
- `shop_get_staff_sales_summary(date,date,int)` exists

---

## C. Migration-history mismatch resolution

Production has a pre-existing remote/local mismatch around version `041` that blocks naive `db push` there.

**Staging approach (safe):** brand-new empty database → no history conflict.

Observed apply order on staging dry-run/push:

- `0411_districts_public_read_registration.sql` **before** `041_admin_vip_plan_control.sql`
- `_apply_044_045_bundle.sql` skipped (invalid name pattern)

`0411` only adjusts `districts` RLS and does not depend on `041`, so this order is safe on a fresh DB.

**No production migration history was repaired or altered.**

---

## D. Tables/RPCs verified

Authenticated staging test owner JWT successfully called:

| RPC | Result |
|-----|--------|
| `shop_get_daily_sales_summary` | ok; today tx=2, revenue=2,515,000 UGX |
| `shop_get_weekly_sales_summary` | ok |
| `shop_get_top_products` (top/slow) | ok; 5 products |
| `shop_get_inventory_insights` | ok; low_stock=2 |
| `shop_get_cash_expense_insights` | ok; today=12,000; week=55,000 |
| `shop_get_customer_insights` | ok; 3 customers |
| `shop_get_staff_sales_summary` | ok; 1 staff aggregate |

---

## E. Synthetic test data created

- Org: **WAKA STAGING**
- Shop: **WAKA TEST SHOP** (`STG-01`)
- Products: Samsung Galaxy S22, Type-C Cable, Bluetooth Speaker, USB Charger, Laptop Bag
- 7 completed sales, 3 expenses, 3 fake customers (no real PII)
- Seed script: `scripts/staging/seed_ask_waka_staging.py`

---

## F. Test owner/shop created

- Email: `askwaka.staging.owner@example.com`
- Password: stored only in `.local/waka-pos-staging-test-owner.env` (not committed)
- Shop id recorded in that file

---

## G. Ask WAKA deployment status

| Target | `ai-ask-waka` |
|--------|----------------|
| Staging `wdirxwvbgsfzbdurmkbf` | **ACTIVE** (deployed) |
| Production `ljaedextsenbkxzzgxcg` | **NOT present** |

Deploy command used:

```bash
supabase functions deploy ai-ask-waka --project-ref wdirxwvbgsfzbdurmkbf --use-api
```

---

## H. DeepSeek secret configuration status

**NOT SET on staging** (`DEEPSEEK_API_KEY` absent from staging secrets).

Value was never printed and was not copied from production.

To complete:

```bash
export DEEPSEEK_API_KEY='...'   # do not commit
./scripts/staging/set_staging_deepseek_secret.sh
```

---

## I. Feature-gate status

| Scope | `enabled` | `ask_waka` |
|-------|-----------|------------|
| Staging platform AI | true | true |
| Staging shop AI | true | true |
| Production platform `ask_waka` | not true (`null`/false) | unchanged |
| Production `ai-ask-waka` function | not deployed | unchanged |

---

## J. Tests

- Vitest Ask WAKA suite: **28 passed**
- `tsc -b`: **pass**
- ESLint on Ask WAKA TS sources: **pass** (seed `.py` ignored by ESLint config)

---

## K. Exact staging smoke command

After DeepSeek secret is set:

```bash
./scripts/staging/smoke_ask_waka.sh
```

Or full ASK-1.2 suite once secret is present.

---

## L. Production was NOT modified

Confirmed:

- No `ai-ask-waka` deploy to `ljaedextsenbkxzzgxcg`
- Production platform `ask_waka` remains unset/false
- Production secrets not modified
- Production RLS/data not modified
- CLI link restored to production after staging work

---

## Remaining before ASK-1.2 live smoke PASS

**DONE (ASK-1.2B):** staging `DEEPSEEK_API_KEY` set; live smoke PASSED. See `docs/PHASE_ASK_WAKA_1_2_STAGING_SMOKE.md`.

Follow-up from smoke: migration `147_ask_waka_usage_kind.sql` applied on staging so `ask_waka_chat` usage rows persist.
