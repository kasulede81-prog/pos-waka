#!/usr/bin/env python3
"""Seed synthetic Ask WAKA staging data. Staging project only. Never run against production."""

from __future__ import annotations

import json
import os
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / ".local" / "waka-pos-staging.env"
OUT_PATH = ROOT / ".local" / "waka-pos-staging-test-owner.env"
PROD_REF = "ljaedextsenbkxzzgxcg"
STAGING_REF = "wdirxwvbgsfzbdurmkbf"

TEST_EMAIL = "askwaka.staging.owner@example.com"
TEST_PASSWORD = "StagingAskWaka!" + secrets.token_hex(4)


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        if not line or "=" not in line or line.startswith("#"):
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def http_json(method: str, url: str, headers: dict[str, str], body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} {url}: {detail[:500]}") from e


def main() -> int:
    if not ENV_PATH.exists():
        print("Missing .local/waka-pos-staging.env", file=sys.stderr)
        return 1
    env = load_env()
    ref = env.get("STAGING_PROJECT_REF", "")
    if ref != STAGING_REF:
        print(f"Refusing: unexpected staging ref {ref}", file=sys.stderr)
        return 1
    if ref == PROD_REF:
        print("Refusing: production ref", file=sys.stderr)
        return 1

    base = env["STAGING_SUPABASE_URL"].rstrip("/")
    service = env["STAGING_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service,
        "Authorization": f"Bearer {service}",
        "Content-Type": "application/json",
    }

    # Create or fetch auth user
    try:
        user = http_json(
            "POST",
            f"{base}/auth/v1/admin/users",
            headers,
            {
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD,
                "email_confirm": True,
                "user_metadata": {"full_name": "Ask WAKA Staging Owner"},
            },
        )
    except RuntimeError as e:
        if "already been registered" in str(e) or "already exists" in str(e).lower():
            listed = http_json(
                "GET",
                f"{base}/auth/v1/admin/users?page=1&per_page=200",
                headers,
            )
            users = listed.get("users") or []
            user = next((u for u in users if (u.get("email") or "").lower() == TEST_EMAIL), None)
            if not user:
                raise
            # update password for deterministic local access
            http_json(
                "PUT",
                f"{base}/auth/v1/admin/users/{user['id']}",
                headers,
                {"password": TEST_PASSWORD, "email_confirm": True},
            )
        else:
            raise

    user_id = user["id"]
    print("created_or_found_user_id=", user_id)

    # Write SQL seed file then execute via supabase db query
    sql_path = Path("/tmp/ask_waka_staging_seed.sql")
    sql_path.write_text(
        f"""
-- Ask WAKA staging synthetic seed (safe fake data only)
begin;

-- Ensure profile
insert into public.profiles (id, full_name)
values ('{user_id}'::uuid, 'Ask WAKA Staging Owner')
on conflict (id) do update set full_name = excluded.full_name;

-- Org + shop
with org as (
  insert into public.organizations (name, slug, created_by, phone_e164)
  values ('WAKA STAGING', 'waka-staging', '{user_id}'::uuid, '+256700000001')
  on conflict (slug) do update set name = excluded.name
  returning id
),
om as (
  insert into public.organization_members (organization_id, user_id, role)
  select id, '{user_id}'::uuid, 'owner' from org
  on conflict (organization_id, user_id) do update set role = 'owner'
  returning organization_id
),
shop as (
  insert into public.shops (organization_id, name, code, phone_e164, business_type, owner_user_id, is_active)
  select organization_id, 'WAKA TEST SHOP', 'STG-01', '+256700000002', 'electronics', '{user_id}'::uuid, true
  from om
  on conflict (organization_id, code) do update
    set name = excluded.name, owner_user_id = excluded.owner_user_id, is_active = true
  returning id
),
sm as (
  insert into public.shop_members (shop_id, user_id, role)
  select id, '{user_id}'::uuid, 'manager' from shop
  on conflict (shop_id, user_id) do update set role = 'manager'
  returning shop_id
)
select shop_id from sm;

-- Clear prior synthetic rows for idempotency
delete from public.sale_payments sp
using public.sales s
where sp.sale_id = s.id
  and s.shop_id in (select id from public.shops where code = 'STG-01');
delete from public.sale_line_items sli
using public.sales s
where sli.sale_id = s.id
  and s.shop_id in (select id from public.shops where code = 'STG-01');
delete from public.sales where shop_id in (select id from public.shops where code = 'STG-01');
delete from public.expenses where shop_id in (select id from public.shops where code = 'STG-01');
delete from public.customers where shop_id in (select id from public.shops where code = 'STG-01');
delete from public.products where shop_id in (select id from public.shops where code = 'STG-01');

with shop as (select id as shop_id from public.shops where code = 'STG-01' limit 1)
insert into public.products (
  shop_id, name, sku, unit, price_ugx, cost_ugx,
  selling_price_per_unit_ugx, cost_price_per_unit_ugx,
  stock_on_hand, reorder_level, minimum_stock_alert, is_active, selling_mode, base_unit
)
select shop_id, x.name, x.sku, 'pcs', x.price, x.cost, x.price, x.cost, x.stock, x.reorder, x.reorder, true, 'unit', 'pcs'
from shop
cross join (
  values
    ('Samsung Galaxy S22', 'STG-S22', 2500000, 2000000, 8, 3),
    ('Type-C Cable', 'STG-CABLE', 15000, 7000, 2, 5),
    ('Bluetooth Speaker', 'STG-SPEAKER', 120000, 70000, 12, 4),
    ('USB Charger', 'STG-CHARGER', 35000, 18000, 1, 5),
    ('Laptop Bag', 'STG-BAG', 75000, 40000, 20, 3)
) as x(name, sku, price, cost, stock, reorder);

with shop as (select id as shop_id from public.shops where code = 'STG-01' limit 1)
insert into public.customers (shop_id, name, metadata)
select shop_id, name, jsonb_build_object('debtBalanceUgx', debt)
from shop
cross join (
  values
    ('Staging Customer A', 25000),
    ('Staging Customer B', 0),
    ('Staging Customer C', 50000)
) as c(name, debt);

-- Sales: today + earlier this week
with shop as (select id as shop_id from public.shops where code = 'STG-01' limit 1),
prods as (
  select p.id, p.name, p.selling_price_per_unit_ugx as price, p.cost_price_per_unit_ugx as cost
  from public.products p
  join shop s on s.shop_id = p.shop_id
),
ins_sales as (
  insert into public.sales (
    shop_id, status, payment_status, subtotal_ugx, total_ugx,
    cash_amount_ugx, created_by, completed_at, created_at, updated_at
  )
  select
    s.shop_id,
    'completed',
    'paid',
    x.total,
    x.total,
    x.total,
    '{user_id}'::uuid,
    x.ts,
    x.ts,
    x.ts
  from shop s
  cross join (
    values
      (now(), 2500000),
      (now() - interval '2 hours', 15000),
      (now() - interval '1 day', 120000),
      (now() - interval '2 days', 35000),
      (now() - interval '3 days', 75000),
      (now() - interval '4 days', 30000),
      (now() - interval '5 days', 240000)
  ) as x(ts, total)
  returning id, total_ugx, created_at
)
insert into public.sale_line_items (
  sale_id, product_id, quantity, unit_price_ugx, line_total_ugx, metadata
)
select
  sa.id,
  p.id,
  1,
  sa.total_ugx,
  sa.total_ugx,
  jsonb_build_object(
    'name', p.name,
    'unitCostUgx', p.cost,
    'estimatedProfitUgx', greatest(sa.total_ugx - p.cost, 0)
  )
from ins_sales sa
join lateral (
  select * from prods
  order by abs(price - sa.total_ugx)
  limit 1
) p on true;

insert into public.sale_payments (sale_id, method, amount_ugx, recorded_by)
select s.id, 'cash', s.total_ugx, '{user_id}'::uuid
from public.sales s
join public.shops sh on sh.id = s.shop_id
where sh.code = 'STG-01' and s.status = 'completed';

with shop as (select id as shop_id from public.shops where code = 'STG-01' limit 1)
insert into public.expenses (
  shop_id, category, amount_ugx, description, paid_on, created_by, expense_type
)
select shop_id, cat, amt, descr, d::date, '{user_id}'::uuid, 'cash_drawer'
from shop
cross join (
  values
    ('transport', 12000, 'Staging boda delivery', (now() at time zone 'Africa/Kampala')::date),
    ('utilities', 25000, 'Staging airtime/data', ((now() at time zone 'Africa/Kampala')::date - 2)),
    ('supplies', 18000, 'Staging packaging bags', ((now() at time zone 'Africa/Kampala')::date - 5))
) as e(cat, amt, descr, d);

-- Enable shop AI for Ask WAKA
insert into public.shop_ai_settings (shop_id, ai_enabled, ask_waka, product_assistant, inventory_assistant, business_setup_assistant)
select id, true, true, true, true, true
from public.shops where code = 'STG-01'
on conflict (shop_id) do update
set ai_enabled = true,
    ask_waka = true,
    product_assistant = true,
    inventory_assistant = true,
    business_setup_assistant = true,
    updated_at = now();

-- Platform AI settings: enable ask_waka on staging only (direct upsert; staging seed)
insert into public.platform_settings (key, value, updated_at)
values (
  'ai_settings',
  public.normalize_ai_settings (
    public.platform_default_ai_settings () || jsonb_build_object(
      'enabled', true,
      'provider', 'deepseek',
      'ask_waka', true,
      'product_assistant', true,
      'inventory_assistant', true,
      'business_setup_assistant', true
    )
  ),
  now()
)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

commit;

select
  (select id::text from public.shops where code = 'STG-01' limit 1) as shop_id,
  (select count(*) from public.products p join public.shops s on s.id = p.shop_id where s.code = 'STG-01') as products,
  (select count(*) from public.sales sa join public.shops s on s.id = sa.shop_id where s.code = 'STG-01' and sa.status = 'completed') as sales;
"""
    )

    # Execute via supabase CLI linked to staging
    import subprocess

    linked = (ROOT / "supabase/.temp/project-ref").read_text().strip()
    if linked != STAGING_REF:
        print(f"Refusing SQL seed: CLI linked to {linked}, not staging", file=sys.stderr)
        return 1

    env_os = os.environ.copy()
    env_os["SEND_EMAIL_HOOK_SECRET"] = env_os.get(
        "SEND_EMAIL_HOOK_SECRET",
        "v1,whsec_dGVzdF9zZWNyZXRfZm9yX2NsaV9jb25maWdfb25seV8xMjM",
    )
    proc = subprocess.run(
        ["supabase", "db", "query", "--linked", "-f", str(sql_path)],
        cwd=str(ROOT),
        env=env_os,
        capture_output=True,
        text=True,
    )
    print(proc.stdout[-2000:] if proc.stdout else "")
    if proc.returncode != 0:
        print(proc.stderr[-2000:], file=sys.stderr)
        return proc.returncode

    # Sign-in to verify credentials
    auth = http_json(
        "POST",
        f"{base}/auth/v1/token?grant_type=password",
        {"apikey": env["STAGING_ANON_KEY"], "Content-Type": "application/json"},
        {"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    access = auth.get("access_token")
    if not access:
        print("Sign-in failed after seed", file=sys.stderr)
        return 1

    shop_id = None
    try:
        # parse shop_id from last query rows if present
        out = proc.stdout
        i = out.rfind("{")
        if i >= 0:
            payload = json.loads(out[i:])
            rows = payload.get("rows") or []
            if rows and rows[0].get("shop_id"):
                shop_id = rows[0]["shop_id"]
    except Exception:
        pass

    OUT_PATH.write_text(
        "\n".join(
            [
                f"STAGING_TEST_EMAIL={TEST_EMAIL}",
                f"STAGING_TEST_PASSWORD={TEST_PASSWORD}",
                f"STAGING_TEST_USER_ID={user_id}",
                f"STAGING_TEST_SHOP_ID={shop_id or ''}",
                f"STAGING_PROJECT_REF={STAGING_REF}",
            ]
        )
        + "\n"
    )
    print("wrote", OUT_PATH)
    print("shop_id=", shop_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
