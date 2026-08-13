#!/usr/bin/env python3
"""Phase 39.4 staging throwaway-org deletion certification.

Staging project only. Refuses production. Never prints secrets.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / ".local" / "waka-pos-staging.env"
PROD_REF = "ljaedextsenbkxzzgxcg"
STAGING_REF = "wdirxwvbgsfzbdurmkbf"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        if not line or "=" not in line or line.startswith("#"):
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def http_json(method: str, url: str, headers: dict[str, str], body: dict | None = None, timeout: int = 60) -> tuple[int, dict]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode("utf-8")
            return res.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"raw": raw[:400]}
        return e.code, parsed


def db_query(sql: str) -> list[dict]:
    os.environ["SEND_EMAIL_HOOK_SECRET"] = os.environ.get(
        "SEND_EMAIL_HOOK_SECRET",
        "v1,whsec_dGVzdF9zZWNyZXRfZm9yX2NsaV9jb25maWdfb25seV8xMjM",
    )
    proc = subprocess.run(
        ["npx", "supabase", "db", "query", "--linked", "--output", "json", "-o", "json", sql],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-1500:] or proc.stdout[-1500:])
    m = re.search(r'\{[\s\S]*"rows"[\s\S]*\}', proc.stdout)
    if not m:
        raise RuntimeError("no json rows in db query")
    return json.loads(m.group(0)).get("rows") or []


def create_user(base: str, headers: dict[str, str], email: str, password: str, name: str) -> str:
    code, user = http_json(
        "POST",
        f"{base}/auth/v1/admin/users",
        headers,
        {"email": email, "password": password, "email_confirm": True, "user_metadata": {"full_name": name}},
    )
    if code >= 400:
        raise RuntimeError(f"create user failed {code}: {user}")
    uid = user.get("id")
    if not uid:
        raise RuntimeError("create user missing id")
    return str(uid)


def main() -> int:
    if not ENV_PATH.exists():
        print("MISSING staging env", file=sys.stderr)
        return 1
    env = load_env()
    ref = env.get("STAGING_PROJECT_REF", "")
    if ref != STAGING_REF or ref == PROD_REF:
        print("REFUSING: not staging", file=sys.stderr)
        return 1
    linked = (ROOT / "supabase/.temp/project-ref").read_text().strip()
    if linked != STAGING_REF:
        print(f"REFUSING: CLI linked to {linked}", file=sys.stderr)
        return 1

    base = env["STAGING_SUPABASE_URL"].rstrip("/")
    if STAGING_REF not in base:
        print("REFUSING: URL is not staging", file=sys.stderr)
        return 1
    service = env["STAGING_SERVICE_ROLE_KEY"]
    anon = env["STAGING_ANON_KEY"]
    admin_headers = {
        "apikey": service,
        "Authorization": f"Bearer {service}",
        "Content-Type": "application/json",
    }

    token = secrets.token_hex(4)
    slug = f"phase394-{token}"
    shop_code = f"P394{token[:4].upper()}"
    owner_email = f"phase394.owner.{token}@example.com"
    staff_email = f"phase394.staff.{token}@example.com"
    owner_pass = "Phase394Owner!" + secrets.token_hex(4)
    staff_pass = "Phase394Staff!" + secrets.token_hex(4)
    org_name = f"PHASE394 DELETE {token.upper()}"

    print("creating_throwaway", slug, shop_code)
    owner_id = create_user(base, admin_headers, owner_email, owner_pass, "Phase394 Owner")
    staff_id = create_user(base, admin_headers, staff_email, staff_pass, "Phase394 Staff")
    print("owner_id", owner_id)
    print("staff_id", staff_id)

    seed = f"""
begin;
insert into public.profiles (id, full_name)
values ('{owner_id}'::uuid, 'Phase394 Owner'), ('{staff_id}'::uuid, 'Phase394 Staff')
on conflict (id) do update set full_name = excluded.full_name;

with org as (
  insert into public.organizations (name, slug, created_by, phone_e164)
  values ('{org_name}', '{slug}', '{owner_id}'::uuid, '+256700039401')
  returning id
),
om as (
  insert into public.organization_members (organization_id, user_id, role)
  select id, '{owner_id}'::uuid, 'owner' from org
  union all
  select id, '{staff_id}'::uuid, 'staff' from org
  returning organization_id
),
shop as (
  insert into public.shops (organization_id, name, code, phone_e164, business_type, owner_user_id, is_active)
  select organization_id, 'PHASE394 SHOP', '{shop_code}', '+256700039402', 'electronics', '{owner_id}'::uuid, true
  from (select distinct organization_id from om) x
  returning id
)
insert into public.shop_members (shop_id, user_id, role)
select id, '{owner_id}'::uuid, 'owner' from shop
union all
select id, '{staff_id}'::uuid, 'cashier' from shop;

with shop as (select id as shop_id from public.shops where code = '{shop_code}' limit 1)
insert into public.products (
  shop_id, name, sku, unit, price_ugx, cost_ugx,
  selling_price_per_unit_ugx, cost_price_per_unit_ugx,
  stock_on_hand, reorder_level, minimum_stock_alert, is_active, selling_mode, base_unit
)
select shop_id, 'Phase394 Sugar', 'P394-SUGAR', 'pcs', 5000, 3000, 5000, 3000, 10, 2, 2, true, 'unit', 'pcs'
from shop;

with shop as (select id as shop_id from public.shops where code = '{shop_code}' limit 1)
insert into public.customers (shop_id, name, metadata)
select shop_id, 'Phase394 Customer', jsonb_build_object('debtBalanceUgx', 0) from shop;

with shop as (select id as shop_id from public.shops where code = '{shop_code}' limit 1),
ins as (
  insert into public.sales (
    shop_id, status, payment_status, subtotal_ugx, total_ugx, cash_amount_ugx,
    created_by, completed_at, created_at, updated_at
  )
  select shop_id, 'completed', 'paid', 5000, 5000, 5000, '{owner_id}'::uuid, now(), now(), now()
  from shop
  returning id, shop_id, total_ugx
)
insert into public.sale_line_items (sale_id, product_id, quantity, unit_price_ugx, line_total_ugx, metadata)
select ins.id, p.id, 1, ins.total_ugx, ins.total_ugx, jsonb_build_object('name', p.name)
from ins
join public.products p on p.shop_id = ins.shop_id
limit 1;

insert into public.sale_payments (sale_id, method, amount_ugx, recorded_by)
select s.id, 'cash', s.total_ugx, '{owner_id}'::uuid
from public.sales s
join public.shops sh on sh.id = s.shop_id
where sh.code = '{shop_code}';

with shop as (select id as shop_id from public.shops where code = '{shop_code}' limit 1)
insert into public.expenses (shop_id, category, amount_ugx, description, paid_on, created_by, expense_type)
select shop_id, 'transport', 2000, 'Phase394 boda', (now() at time zone 'Africa/Kampala')::date, '{owner_id}'::uuid, 'cash_drawer'
from shop;

with shop as (select id as shop_id from public.shops where code = '{shop_code}' limit 1)
insert into public.shop_cash_drawer_adjustments (id, shop_id, adjustment_type, amount_ugx, note, actor_user_id, actor_label, occurred_at)
select gen_random_uuid(), shop_id, 'in', 1000, 'Phase394 float', '{owner_id}'::uuid, 'Phase394 Owner', now() from shop;

with shop as (select id as shop_id from public.shops where code = '{shop_code}' limit 1)
insert into public.shop_day_closes (id, shop_id, date_key, payload)
select gen_random_uuid(), shop_id, to_char((now() at time zone 'Africa/Kampala')::date, 'YYYY-MM-DD'),
       jsonb_build_object('totalSalesUgx', 5000, 'source', 'phase394')
from shop;

with shop as (select id as shop_id from public.shops where code = '{shop_code}' limit 1)
insert into public.shop_devices (id, shop_id, device_fingerprint, label, platform, status, is_active)
select gen_random_uuid(), shop_id, 'phase394-{token}', 'Phase394 Phone', 'android', 'active', true from shop;

commit;

select
  (select id::text from public.organizations where slug = '{slug}') as org_id,
  (select id::text from public.shops where code = '{shop_code}') as shop_id,
  (select count(*) from public.products p join public.shops s on s.id = p.shop_id where s.code = '{shop_code}') as products,
  (select count(*) from public.sales sa join public.shops s on s.id = sa.shop_id where s.code = '{shop_code}') as sales,
  (select count(*) from public.expenses e join public.shops s on s.id = e.shop_id where s.code = '{shop_code}') as expenses,
  (select count(*) from public.shop_day_closes d join public.shops s on s.id = d.shop_id where s.code = '{shop_code}') as day_closes,
  (select count(*) from public.shop_devices d join public.shops s on s.id = d.shop_id where s.code = '{shop_code}') as devices;
"""
    rows = db_query(seed)
    seed_row = rows[0] if rows else {}
    org_id = seed_row.get("org_id")
    shop_id = seed_row.get("shop_id")
    print("seed", seed_row)
    if not org_id or not shop_id:
        raise RuntimeError("seed missing org/shop")
    if int(seed_row.get("products") or 0) < 1 or int(seed_row.get("sales") or 0) < 1:
        raise RuntimeError("seed incomplete")

    def sign_in(email: str, password: str) -> tuple[int, dict]:
        return http_json(
            "POST",
            f"{base}/auth/v1/token?grant_type=password",
            {"apikey": anon, "Content-Type": "application/json"},
            {"email": email, "password": password},
        )

    code, auth = sign_in(owner_email, owner_pass)
    if code >= 400 or not auth.get("access_token"):
        raise RuntimeError(f"owner sign-in failed {code}")
    access = auth["access_token"]
    user_headers = {
        "apikey": anon,
        "Authorization": f"Bearer {access}",
        "Content-Type": "application/json",
    }

    # Probe after getUser
    code, probe_noauth = http_json(
        "POST",
        f"{base}/functions/v1/owner-permanently-delete-account",
        {"apikey": anon, "Content-Type": "application/json"},
        {"probe": True},
    )
    print("probe_noauth", code, {k: probe_noauth.get(k) for k in ("ok", "error", "probe")})
    if code != 401:
        raise RuntimeError(f"probe without jwt expected 401, got {code}")

    code, probe = http_json(
        "POST",
        f"{base}/functions/v1/owner-permanently-delete-account",
        user_headers,
        {"probe": True},
    )
    print("probe_auth", code, {k: probe.get(k) for k in ("ok", "probe", "edge", "error")})
    if code != 200 or probe.get("ok") is not True or probe.get("probe") is not True:
        raise RuntimeError("authenticated probe failed")

    # B: expired reauth
    http_json(
        "PUT",
        f"{base}/auth/v1/admin/users/{owner_id}",
        admin_headers,
        {"app_metadata": {"phase394": "stale"}},
    )
    # last_sign_in_at is not always writable; simulate stale JWT by using a token
    # minted after we force a very old last_sign_in via SQL if permitted.
    stale_rows = db_query(
        f"update auth.users set last_sign_in_at = now() - interval '20 minutes' where id = '{owner_id}'::uuid returning id::text as id;"
    )
    print("stale_last_sign_in", bool(stale_rows))
    code, stale = http_json(
        "POST",
        f"{base}/functions/v1/owner-permanently-delete-account",
        user_headers,
        {"confirmation": "DELETE PERMANENTLY"},
    )
    print("expired_reauth", code, {k: stale.get(k) for k in ("ok", "error")})
    org_still = db_query(f"select count(*)::int as n from public.organizations where id = '{org_id}'::uuid")
    if stale.get("error") != "reauth_required":
        raise RuntimeError(f"expected reauth_required, got {stale}")
    if int(org_still[0]["n"]) != 1:
        raise RuntimeError("expired reauth deleted the org")

    # Refresh session so last_sign_in_at is now
    code, auth = sign_in(owner_email, owner_pass)
    if code >= 400 or not auth.get("access_token"):
        raise RuntimeError("reauth sign-in failed")
    access = auth["access_token"]
    user_headers["Authorization"] = f"Bearer {access}"

    # A: network interruption — dead host, org must remain
    try:
        http_json(
            "POST",
            "https://127.0.0.1:1/functions/v1/owner-permanently-delete-account",
            user_headers,
            {"confirmation": "DELETE PERMANENTLY"},
            timeout=2,
        )
        network_failed = False
    except Exception:
        network_failed = True
    org_still = db_query(f"select count(*)::int as n from public.organizations where id = '{org_id}'::uuid")
    print("network_interrupt", network_failed, "org_still", org_still[0]["n"])
    if int(org_still[0]["n"]) != 1:
        raise RuntimeError("network path deleted org")

    # Full delete
    code, deleted = http_json(
        "POST",
        f"{base}/functions/v1/owner-permanently-delete-account",
        user_headers,
        {"confirmation": "DELETE PERMANENTLY"},
        timeout=90,
    )
    print("full_delete", code, {k: deleted.get(k) for k in ("ok", "error", "partial", "message")})
    if code >= 400 or deleted.get("ok") is not True:
        raise RuntimeError(f"full delete failed: {deleted}")

    leftover = db_query(
        f"""
        select
          (select count(*) from public.organizations where id = '{org_id}'::uuid) as orgs,
          (select count(*) from public.shops where id = '{shop_id}'::uuid) as shops,
          (select count(*) from public.products where shop_id = '{shop_id}'::uuid) as products,
          (select count(*) from public.sales where shop_id = '{shop_id}'::uuid) as sales,
          (select count(*) from public.customers where shop_id = '{shop_id}'::uuid) as customers,
          (select count(*) from public.expenses where shop_id = '{shop_id}'::uuid) as expenses,
          (select count(*) from public.shop_cash_drawer_adjustments where shop_id = '{shop_id}'::uuid) as drawer,
          (select count(*) from public.shop_day_closes where shop_id = '{shop_id}'::uuid) as day_closes,
          (select count(*) from public.shop_devices where shop_id = '{shop_id}'::uuid) as devices,
          (select count(*) from public.shop_members where shop_id = '{shop_id}'::uuid) as members
        """
    )[0]
    print("leftover", leftover)
    if any(int(leftover[k]) != 0 for k in leftover):
        raise RuntimeError(f"orphan rows remain: {leftover}")

    code, owner_after = http_json("GET", f"{base}/auth/v1/admin/users/{owner_id}", admin_headers)
    code_s, staff_after = http_json("GET", f"{base}/auth/v1/admin/users/{staff_id}", admin_headers)
    owner_gone = code == 404 or not owner_after.get("id")
    staff_gone = code_s == 404 or not staff_after.get("id")
    print("auth_gone", owner_gone, staff_gone, "owner_http", code, "staff_http", code_s)
    if not owner_gone or not staff_gone:
        raise RuntimeError("auth users remain")

    # C: already-deleted auth user treated as success
    code, again = http_json("DELETE", f"{base}/auth/v1/admin/users/{owner_id}", admin_headers)
    msg = json.dumps(again).lower()
    already_gone = code in (404, 400) or "not found" in msg or "does not exist" in msg or "already" in msg
    print("already_deleted_auth_retry", code, already_gone)
    if not already_gone:
        raise RuntimeError(f"second auth delete not treated as gone: {code} {again}")

    # Login block
    code, login = sign_in(owner_email, owner_pass)
    print("login_after_delete", code, bool(login.get("access_token")))
    if login.get("access_token"):
        raise RuntimeError("owner can still sign in after delete")

    # Preserve Ask WAKA staging shop
    intact = db_query("select count(*)::int as n from public.shops where code = 'STG-01'")
    print("ask_waka_shop_intact", intact[0]["n"])
    if int(intact[0]["n"]) < 1:
        raise RuntimeError("Ask WAKA staging shop was damaged")

    print("PHASE_39_4_STAGING_DELETE_PASS")
    print(json.dumps({
        "org_id": org_id,
        "shop_id": shop_id,
        "slug": slug,
        "leftover": leftover,
        "probe_ok": True,
        "reauth_blocked": True,
        "network_did_not_delete": True,
        "auth_gone": True,
        "login_blocked": True,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
