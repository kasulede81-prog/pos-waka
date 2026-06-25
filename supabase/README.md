# Waka POS — Supabase backend

Production-oriented PostgreSQL schema, Row Level Security (RLS), and automation for multi-tenant retail (organization → shops → staff) with Uganda-focused payments and UGX billing.

Hosted app setup (Vercel env, auth redirect URLs, Android): see **[docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md)**.

## Prerequisites

- **Supabase** project (PostgreSQL **15+**)
- **Supabase Auth** enabled for your app (email/phone as configured)

## Apply migrations

Run files in **`migrations/`** in numerical order (`001` … `020`). Objects depend on earlier files (extensions → tables → functions → RLS → seed → grants → kiosk extensions → shop business type → audit/roles → SaaS bootstrap → internal ops).

### Option A — Supabase SQL Editor

1. Open **SQL** → **New query**.
2. Paste and run each file’s contents in order, or concatenate them in one script if you prefer a single run (same order).

### Option B — Supabase CLI

From the project root (`pos-waka`):

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

If you manage migrations only as flat SQL (no remote history sync), you can instead run:

```bash
supabase db execute --file supabase/migrations/001_extensions.sql
# … repeat for each migration in order
```

## What gets created

| Area | Contents |
|------|----------|
| Identity | `profiles` (1:1 `auth.users`), trigger `on_auth_user_created` → `handle_new_user` |
| Tenancy | `organizations`, `organization_members`, `shops`, `shop_members` |
| Catalog / stock | `product_categories`, `products`, `inventory_movements` |
| Sales | `customers`, `sales`, `sale_line_items`, `sale_payments`, `receipts`, `shop_counters` |
| Ops | `expenses` |
| SaaS | `subscription_plans`, `subscriptions` (trial, monthly/year, `admin_discount_percent`) |
| Security | RLS on all tenant/business tables; helper functions in `007` / policies in `008` |
| Seed | **009** upserts default UGX plans (Small shop 37k, Wholesale 100k, Supermarket 150k) |
| Grants | **010** table/sequence privileges for `authenticated` |
| Kiosk / duka | **011** product selling modes (`unit` / `weighted` / `portion`), per–base-unit prices, sell-by-money columns on `sale_line_items`, optional receipts (`sales.issue_receipt`), `debt_amount_ugx`, inventory reasons (`damaged`, `personal`, …), updated `rpc_low_stock` / `rpc_inventory_adjust` |
| Business profile | **012** `shops.business_type` (kiosk, wholesale, restaurant, …) for synced adaptive defaults |

## Auth profile bootstrap

On every `auth.users` insert, **`public.handle_new_user`** upserts **`public.profiles`** using optional `raw_user_meta_data` keys:

- `full_name`
- `business_name`
- `phone_e164` (must match `+256` + 9 digits when provided)

## Environment (frontend)

Use your Supabase project URL and anon key (see **Project Settings → API**):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Configure **Authentication → URL Configuration** with your app’s site URL and redirect URLs for email magic links / OAuth.

## Optional demo data

See **`seed/demo_seed.sql`**: template only (commented). Replace the sample UUID with a real `auth.users.id` from **Authentication → Users** before running in a **dev** project.

## Documentation

- **Row Level Security**: [`docs/RLS.md`](./docs/RLS.md)

## Uganda / payments fields

- Phone checks: E.164 **`+256XXXXXXXXX`** on profiles, orgs, shops, customers where applicable.
- Sales support **cash** (`cash_amount_ugx` on `sales`), **MTN MoMo** (`mtn_momo_reference`), **Airtel Money** (`airtel_money_reference`), and generic `sale_payments` rows.

## Internal Waka staff (`internal_admins`)

Migrations **018–020** add `internal_admins`, `districts`, `field_visits`, `support_requests`, and RPCs such as `waka_internal_me`, `admin_extend_subscription_trial`, `shop_record_last_seen`. The app’s internal dashboard reads live data only when your **auth user** has a matching row in `public.internal_admins` with `active = true`.

### Bootstrap the first super admin (example)

1. In **Authentication → Users**, copy the **UUID** of the staff account (e.g. `kasule.de81@gmail.com` after they sign up once).
2. In the SQL editor (service role / dashboard SQL is fine), run:

```sql
insert into public.internal_admins (user_id, email, role, assigned_district_ids, max_shops, active)
values (
  '<paste-auth-user-uuid-here>'::uuid,
  'kasule.de81@gmail.com',
  'super_admin',
  '{}'::uuid[],
  null,
  true
)
on conflict (user_id) do update
set
  email = excluded.email,
  role = excluded.role,
  active = excluded.active;
```

3. Re-sign-in if needed. The client calls `waka_internal_me()`; RLS and SECURITY DEFINER RPCs enforce access — **do not rely on env allowlists alone in production.**

## Cloud shop backup (new phone restore)

Migration **052** adds `shop_cloud_snapshots`: the app uploads a full shop snapshot after sync so owners can sign in on a **new phone** and recover products, sales, settings, and archived data from Waka storage (not only a JSON file).

Requires migration **052** applied and the old phone to have synced while online recently.

## Waka shop numbers (A001, A002, …)

Migration **055** assigns every shop a **site-wide number** by signup order: first shop = **A001**, second = **A002**, etc. New shops get a number automatically on insert. Support can look up shops by **A001** instead of UUID.

## Internal shop card (products & metrics)

Migration **054** lets support see **product counts**, a **product list**, and **cloud backup** stats on the shop user card. Run after **045** (or if counts show 0 incorrectly).

## Edge functions (support tools)

Deploy after migrations **049–051** so internal admin can reset owner passwords and permanently delete shop accounts:

```bash
supabase link --project-ref <your-project-ref>
npm run supabase:deploy:admin
```

Functions:

| Function | Purpose |
|----------|---------|
| `admin-set-owner-password` | Support/super admin sets owner login password (no email link) |
| `admin-permanently-delete-shop-account` | Super admin deletes org data + auth user |
| `auth-send-email` | Supabase Auth **Send Email** hook → Resend (`noreply@waka.ug`) |

Deploy transactional email (after migration **115**):

```bash
npm run supabase:deploy:email
supabase secrets set --env-file supabase/functions/.env --project-ref <your-project-ref>
```

Then enable **Authentication → Hooks → Send Email** in the Supabase dashboard (see `supabase/functions/.env.example`).

## Troubleshooting

- **“permission denied for table …”** after migrations: ensure **010_grants.sql** ran after RLS.
- **First org bootstrap**: `organizations` is readable if `created_by = auth.uid()` before any `organization_members` row exists; `organization_members` select includes **own row** (`user_id = auth.uid()`).
- **Sale completion / receipt**: completing a sale runs triggers that insert `inventory_movements`, `receipts`, and update `shop_counters`; policies require **cashier-or-above** at that shop.
