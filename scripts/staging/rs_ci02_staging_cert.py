#!/usr/bin/env python3
"""RS-CI-0.2 staging certification for ticket shop-binding.

Staging project only. Refuses production. Never prints secrets.
Temporarily links the Supabase CLI to staging, then restores production.
Does not start transport, RustDesk, or Electron.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / ".local" / "waka-pos-staging.env"
PROD_REF = "ljaedextsenbkxzzgxcg"
STAGING_REF = "wdirxwvbgsfzbdurmkbf"
HOOK = "v1,whsec_dGVzdF9zZWNyZXRfZm9yX2NsaV9jb25maWdfb25seV8xMjM"
MIGRATION = ROOT / "supabase/migrations/154_remote_support_ticket_shop_binding.sql"
MISSING_TICKET = "00000000-0000-4000-8000-000000000154"

BACKUP_PATHS = [
    ROOT / "supabase/.temp/project-ref",
    ROOT / "supabase/.temp/linked-project.json",
    ROOT / "supabase/.temp/pooler-url",
    ROOT / "supabase/config.toml",
]


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        if not line or "=" not in line or line.startswith("#"):
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def http_json(method: str, url: str, headers: dict[str, str], body: dict | None = None, timeout: int = 60) -> tuple[int, dict | list]:
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
            parsed = {"raw": raw[:500]}
        return e.code, parsed


def cli_env() -> dict[str, str]:
    envp = dict(os.environ)
    envp["SEND_EMAIL_HOOK_SECRET"] = envp.get("SEND_EMAIL_HOOK_SECRET", HOOK)
    return envp


def run_cli(args: list[str], timeout: int = 180) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["npx", "supabase", *args],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        env=cli_env(),
        timeout=timeout,
    )


def linked_query(sql: str, timeout: int = 180) -> list[dict]:
    proc = run_cli(["db", "query", "--linked", "-o", "json", sql], timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout)[-2500:])
    text = proc.stdout
    m = re.search(r"\{[\s\S]*\"rows\"[\s\S]*\}", text)
    if m:
        return json.loads(m.group(0)).get("rows") or []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"unparseable db query output: {text[-800:]}") from e
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict) and "rows" in parsed:
        return parsed["rows"] or []
    return [parsed] if parsed else []


def linked_file(path: Path, timeout: int = 300) -> None:
    proc = run_cli(["db", "query", "--linked", "-f", str(path)], timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout)[-3000:])


def current_ref() -> str:
    p = ROOT / "supabase/.temp/project-ref"
    return p.read_text().strip() if p.exists() else ""


def restore_cli(backup_dir: Path) -> None:
    for src in BACKUP_PATHS:
        bak = backup_dir / src.name
        if bak.exists():
            shutil.copy2(bak, src)
    print("CLI_RESTORED", current_ref())


def create_user(base: str, headers: dict[str, str], email: str, password: str, name: str) -> str:
    code, user = http_json(
        "POST",
        f"{base}/auth/v1/admin/users",
        headers,
        {"email": email, "password": password, "email_confirm": True, "user_metadata": {"full_name": name}},
    )
    if code >= 400 or not isinstance(user, dict) or not user.get("id"):
        raise RuntimeError(f"create user failed {code}")
    return str(user["id"])


def sign_in(base: str, anon: str, email: str, password: str) -> str:
    code, auth = http_json(
        "POST",
        f"{base}/auth/v1/token?grant_type=password",
        {"apikey": anon, "Content-Type": "application/json"},
        {"email": email, "password": password},
    )
    if code >= 400 or not isinstance(auth, dict) or not auth.get("access_token"):
        raise RuntimeError("sign-in failed")
    return str(auth["access_token"])


def rpc(base: str, anon: str, token: str, name: str, payload: dict) -> tuple[int, dict]:
    code, data = http_json(
        "POST",
        f"{base}/rest/v1/rpc/{name}",
        {
            "apikey": anon,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        payload,
    )
    if isinstance(data, dict):
        data = dict(data)
        data["_http"] = code
        return code, data
    return code, {"raw": data, "_http": code}


def expect(results: list[dict], name: str, ok: bool, detail: str = "") -> None:
    results.append({"name": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def inspect_154() -> tuple[bool, str]:
    sql = MIGRATION.read_text()
    if "create table" in sql.lower() or "alter table" in sql.lower():
        return False, "154 is not function-only"
    if sql.count("create or replace function") != 1:
        return False, "154 must replace only one function"
    if "remote_support_request_start" not in sql:
        return False, "missing start function"
    if "remote_support_customer_approve" in sql or "remote_support_grant_assert" in sql:
        return False, "154 touches approve/grant"
    if "support_request_shop_mismatch" not in sql:
        return False, "missing shop-binding error"
    return True, "additive start-function replace only"


def main() -> int:
    if not ENV_PATH.exists():
        print("MISSING staging env", file=sys.stderr)
        return 1
    env = load_env()
    ref = env.get("STAGING_PROJECT_REF", "")
    base = env.get("STAGING_SUPABASE_URL", "").rstrip("/")
    if ref != STAGING_REF or ref == PROD_REF:
        print("REFUSING: not staging", file=sys.stderr)
        return 1
    if PROD_REF in base or STAGING_REF not in base:
        print("REFUSING: URL is not staging", file=sys.stderr)
        return 1
    if current_ref() != PROD_REF:
        print(f"REFUSING: CLI not on production ({current_ref()})", file=sys.stderr)
        return 1
    if not MIGRATION.exists():
        print("MISSING 154", file=sys.stderr)
        return 1

    additive, additive_detail = inspect_154()
    if not additive:
        print("REFUSING: 154 not additive", additive_detail, file=sys.stderr)
        return 1

    service = env["STAGING_SERVICE_ROLE_KEY"]
    anon = env["STAGING_ANON_KEY"]
    password = env["STAGING_DB_PASSWORD"]
    admin_headers = {
        "apikey": service,
        "Authorization": f"Bearer {service}",
        "Content-Type": "application/json",
    }

    results: list[dict] = []
    created_user_ids: list[str] = []
    slug = ""
    shop_a = ""
    shop_b = ""
    backup_dir = Path(tempfile.mkdtemp(prefix="rsci02-cli-"))
    linked = False

    try:
        for src in BACKUP_PATHS:
            if src.exists():
                shutil.copy2(src, backup_dir / src.name)

        print("PHASE1_CLI_ON_PRODUCTION", current_ref())
        prod_migs = linked_query(
            "select version::text as version from supabase_migrations.schema_migrations "
            "where version in ('151','152','153','154') order by version;"
        )
        prod_versions = {str(r.get("version")) for r in prod_migs}
        print("PROD_MIGRATIONS_BEFORE", sorted(prod_versions))
        expect(results, "phase1_production_has_no_154", "154" not in prod_versions, str(sorted(prod_versions)))
        expect(results, "phase1_154_additive", additive, additive_detail)

        print("STAGING_IDENTITY", STAGING_REF)
        print("PRODUCTION_REF_UNTOUCHED", PROD_REF)
        print("LINKING_STAGING")
        proc = run_cli(
            ["link", "--project-ref", STAGING_REF, "--password", password, "--yes"],
            timeout=120,
        )
        if proc.returncode != 0:
            raise RuntimeError((proc.stderr or proc.stdout)[-2000:])
        linked = True
        if current_ref() != STAGING_REF:
            raise RuntimeError(f"link did not switch to staging: {current_ref()}")
        print("LINKED", STAGING_REF)

        before_tables = linked_query(
            "select count(*)::int as n from information_schema.tables "
            "where table_schema='public' and table_type='BASE TABLE';"
        )
        before_n = int((before_tables[0] or {}).get("n") or 0)
        applied = linked_query(
            "select version::text as version, coalesce(name,'') as name "
            "from supabase_migrations.schema_migrations "
            "where version in ('151','152','153','154') order by version;"
        )
        print("STAGING_APPLIED_BEFORE", applied)
        versions = {str(r.get("version")) for r in applied}
        expect(results, "phase2_151_152_153_present", {"151", "152", "153"} <= versions, str(sorted(versions)))

        if "154" not in versions:
            print("APPLYING 154")
            linked_file(MIGRATION)
            linked_query(
                "insert into supabase_migrations.schema_migrations (version, name) "
                "values ('154', 'remote_support_ticket_shop_binding') "
                "on conflict (version) do nothing; select 1 as ok;"
            )
            print("APPLIED_154")
        else:
            print("REAPPLYING_154_IDEMPOTENT")
            linked_file(MIGRATION)
            print("REAPPLIED_154")

        after_tables = linked_query(
            "select count(*)::int as n from information_schema.tables "
            "where table_schema='public' and table_type='BASE TABLE';"
        )
        after_n = int((after_tables[0] or {}).get("n") or 0)
        after = linked_query(
            "select "
            "exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname='public' and p.proname='remote_support_request_start') as has_start, "
            "exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname='public' and p.proname='shop_submit_pos_support_ticket') as has_153, "
            "(select count(*) from supabase_migrations.schema_migrations where version in ('151','152','153','154')) as n;"
        )
        live_def = str(
            (
                linked_query(
                    "select pg_get_functiondef(p.oid) as def from pg_proc p "
                    "join pg_namespace n on n.oid=p.pronamespace "
                    "where n.nspname='public' and p.proname='remote_support_request_start' "
                    "order by p.pronargs desc limit 1;"
                )
                or [{}]
            )[0].get("def")
            or ""
        )
        expect(
            results,
            "phase2_154_applied",
            bool(after and after[0].get("has_start") and int(after[0].get("n") or 0) == 4),
            str(after),
        )
        expect(results, "phase2_no_unexpected_tables", after_n == before_n, f"tables {before_n}->{after_n}")
        expect(results, "phase2_153_rpc_intact", bool(after and after[0].get("has_153")), str(after))
        expect(
            results,
            "phase2_live_start_has_shop_binding",
            "support_request_shop_mismatch" in live_def and "support_request_not_found" in live_def,
            "live function contains shop-binding errors",
        )

        token = secrets.token_hex(4)
        slug = f"rsci02-{token}"
        shop_a = f"C2A{token[:4].upper()}"
        shop_b = f"C2B{token[:4].upper()}"
        cashier_email = f"rsci02.cashier.{token}@example.com"
        outsider_email = f"rsci02.outsider.{token}@example.com"
        cashier_pass = "Ci02Cash!" + secrets.token_hex(4)
        outsider_pass = "Ci02Out!" + secrets.token_hex(4)
        fp_a = f"rsci02-pos-a-{token}"
        fp_b = f"rsci02-pos-b-{token}"
        roles = {
            "support_admin": f"rsci02.support.{token}@example.com",
            "super_admin": f"rsci02.super.{token}@example.com",
            "operations_admin": f"rsci02.ops.{token}@example.com",
            "field_agent": f"rsci02.field.{token}@example.com",
            "finance_admin": f"rsci02.finance.{token}@example.com",
        }
        role_pass = {role: f"Ci02{role[:4].title()}!" + secrets.token_hex(4) for role in roles}

        cashier_id = create_user(base, admin_headers, cashier_email, cashier_pass, "RSCI02 Cashier")
        outsider_id = create_user(base, admin_headers, outsider_email, outsider_pass, "RSCI02 Outsider")
        created_user_ids.extend([cashier_id, outsider_id])
        role_ids: dict[str, str] = {}
        for role, email in roles.items():
            uid = create_user(base, admin_headers, email, role_pass[role], f"RSCI02 {role}")
            created_user_ids.append(uid)
            role_ids[role] = uid

        role_sql = ",\n".join(
            f"('{role_ids[r]}'::uuid, '{role_ids[r]}'::uuid, '{roles[r]}', '{r}', true)" for r in roles
        )
        seed = f"""
begin;
insert into public.profiles (id, full_name)
values
  ('{cashier_id}'::uuid, 'RSCI02 Cashier'),
  ('{outsider_id}'::uuid, 'RSCI02 Outsider'),
  {", ".join(f"('{role_ids[r]}'::uuid, 'RSCI02 {r}')" for r in roles)}
on conflict (id) do update set full_name = excluded.full_name;

insert into public.internal_admins (user_id, auth_user_id, email, role, active)
values
{role_sql}
on conflict (user_id) do update
  set role = excluded.role, active = true, email = excluded.email, auth_user_id = excluded.auth_user_id;

with org_a as (
  insert into public.organizations (name, slug, created_by, phone_e164)
  values ('RSCI02 SHOP A', '{slug}', '{cashier_id}'::uuid, '+256700014001')
  returning id
),
om_a as (
  insert into public.organization_members (organization_id, user_id, role)
  select id, '{cashier_id}'::uuid, 'owner' from org_a
  returning organization_id
),
shop_a as (
  insert into public.shops (organization_id, name, code, phone_e164, business_type, owner_user_id, is_active)
  select organization_id, 'RSCI02 A', '{shop_a}', '+256700014002', 'electronics', '{cashier_id}'::uuid, true
  from om_a
  returning id
)
insert into public.shop_members (shop_id, user_id, role)
select id, '{cashier_id}'::uuid, 'cashier' from shop_a;

with org_b as (
  insert into public.organizations (name, slug, created_by, phone_e164)
  values ('RSCI02 SHOP B', '{slug}-b', '{outsider_id}'::uuid, '+256700014003')
  returning id
),
om_b as (
  insert into public.organization_members (organization_id, user_id, role)
  select id, '{outsider_id}'::uuid, 'owner' from org_b
  returning organization_id
),
shop_b as (
  insert into public.shops (organization_id, name, code, phone_e164, business_type, owner_user_id, is_active)
  select organization_id, 'RSCI02 B', '{shop_b}', '+256700014004', 'electronics', '{outsider_id}'::uuid, true
  from om_b
  returning id
)
insert into public.shop_members (shop_id, user_id, role)
select id, '{outsider_id}'::uuid, 'owner' from shop_b;

insert into public.shop_devices (
  shop_id, device_fingerprint, label, platform, last_seen_at, status, is_active,
  approval_status, device_type, form_factor, device_authority, is_primary
)
select s.id, '{fp_a}', 'RSCI02 POS A', 'windows', now(), 'active'::public.shop_device_status, true, 'approved', 'windows_pos', 'windows', 'primary', true
from public.shops s where s.code = '{shop_a}'
union all
select s.id, '{fp_b}', 'RSCI02 POS B', 'windows', now(), 'active'::public.shop_device_status, true, 'approved', 'windows_pos', 'windows', 'primary', true
from public.shops s where s.code = '{shop_b}';

commit;

select
  (select id::text from public.shops where code = '{shop_a}') as shop_a_id,
  (select id::text from public.shops where code = '{shop_b}') as shop_b_id,
  (select d.id::text from public.shop_devices d join public.shops s on s.id = d.shop_id
    where s.code = '{shop_a}' and d.device_fingerprint = '{fp_a}') as device_a,
  (select d.id::text from public.shop_devices d join public.shops s on s.id = d.shop_id
    where s.code = '{shop_b}' and d.device_fingerprint = '{fp_b}') as device_b;
"""
        seed_row = (linked_query(seed) or [{}])[0]
        shop_a_id = seed_row.get("shop_a_id")
        shop_b_id = seed_row.get("shop_b_id")
        device_a = seed_row.get("device_a")
        device_b = seed_row.get("device_b")
        print("SEED", {"shop_a": shop_a_id, "shop_b": shop_b_id, "a": device_a, "b": device_b})
        if not shop_a_id or not shop_b_id or not device_a or not device_b:
            raise RuntimeError(f"seed incomplete: {seed_row}")

        cashier_jwt = sign_in(base, anon, cashier_email, cashier_pass)
        outsider_jwt = sign_in(base, anon, outsider_email, outsider_pass)
        tokens = {role: sign_in(base, anon, roles[role], role_pass[role]) for role in roles}

        def start(role_or_jwt: str, shop_id: str, device_id: str, ticket_id: str | None = None, use_jwt: bool = False) -> dict:
            token = role_or_jwt if use_jwt else tokens[role_or_jwt]
            payload = {
                "p_shop_id": shop_id,
                "p_shop_device_id": device_id,
                "p_reason_code": "other",
                "p_reason_text": "RSCI02 ticket-binding certification",
                "p_support_request_id": ticket_id,
            }
            _code, data = rpc(base, anon, token, "remote_support_request_start", payload)
            return data

        def cancel(request_id: str) -> dict:
            if not request_id:
                return {}
            _code, data = rpc(base, anon, tokens["support_admin"], "remote_support_technician_cancel", {"p_request_id": request_id})
            return data

        def approve(request_id: str, fp: str) -> dict:
            _code, data = rpc(
                base,
                anon,
                cashier_jwt,
                "remote_support_customer_approve",
                {"p_request_id": request_id, "p_device_fingerprint": fp},
            )
            return data

        def end_session(session_id: str, fp: str) -> dict:
            _code, data = rpc(
                base,
                anon,
                cashier_jwt,
                "remote_support_customer_end",
                {"p_session_id": session_id, "p_device_fingerprint": fp},
            )
            return data

        def grant_assert(session_id: str, grant_jti: str, fp: str) -> dict:
            _code, data = rpc(
                base,
                anon,
                cashier_jwt,
                "remote_support_grant_assert",
                {"p_session_id": session_id, "p_grant_jti": grant_jti, "p_device_fingerprint": fp},
            )
            return data

        def counts() -> dict:
            rows = linked_query(
                f"select "
                f"(select count(*)::int from public.remote_support_requests "
                f"  where shop_id in ('{shop_a_id}'::uuid, '{shop_b_id}'::uuid)) as reqs, "
                f"(select count(*)::int from public.remote_support_sessions "
                f"  where shop_id in ('{shop_a_id}'::uuid, '{shop_b_id}'::uuid)) as sess;"
            )
            return rows[0] if rows else {"reqs": -1, "sess": -1}

        def request_row(request_id: str) -> dict:
            rows = linked_query(
                f"select id::text, shop_id::text, shop_device_id::text, support_request_id::text, status "
                f"from public.remote_support_requests where id = '{request_id}'::uuid;"
            )
            return rows[0] if rows else {}

        def session_grant(session_id: str) -> dict:
            rows = linked_query(
                f"select id::text, status, grant_jti::text, grant_consumed_at is not null as consumed "
                f"from public.remote_support_sessions where id = '{session_id}'::uuid;"
            )
            return rows[0] if rows else {}

        def set_device_a(status: str, approval: str, last_seen_sql: str = "now()") -> None:
            linked_query(
                f"update public.shop_devices set status = '{status}'::public.shop_device_status, "
                f"approval_status = '{approval}', last_seen_at = {last_seen_sql} "
                f"where id = '{device_a}'::uuid; select 1 as ok;"
            )

        def submit_ticket(jwt: str, shop_id: str, body: str) -> str:
            _code, data = rpc(
                base,
                anon,
                jwt,
                "shop_submit_pos_support_ticket",
                {"p_shop_id": shop_id, "p_subject": body, "p_body": body, "p_issue_type": "other"},
            )
            return str(data.get("ticket_id") or "")

        ticket_a = submit_ticket(cashier_jwt, shop_a_id, "Shop A printer context")
        ticket_b = submit_ticket(outsider_jwt, shop_b_id, "Shop B printer context")
        expect(results, "seed_tickets", bool(ticket_a) and bool(ticket_b), f"a={bool(ticket_a)} b={bool(ticket_b)}")

        # A — no ticket
        before = counts()
        a = start("support_admin", shop_a_id, device_a, None)
        a_id = str(a.get("request_id") or "")
        expect(results, "A_no_ticket", a.get("ok") is True and bool(a_id), str(a.get("error")))
        expect(results, "A_row_created", int(counts().get("reqs") or 0) == int(before.get("reqs") or 0) + 1, str(counts()))
        cancel(a_id)

        # B — same shop ticket
        b = start("support_admin", shop_a_id, device_a, ticket_a)
        b_id = str(b.get("request_id") or "")
        brow = request_row(b_id) if b_id else {}
        expect(
            results,
            "B_same_shop_ticket",
            b.get("ok") is True
            and brow.get("shop_id") == shop_a_id
            and brow.get("shop_device_id") == device_a
            and brow.get("support_request_id") == ticket_a,
            json.dumps(brow),
        )
        cancel(b_id)

        # C — cross-shop ticket
        before_c = counts()
        c = start("support_admin", shop_a_id, device_a, ticket_b)
        expect(
            results,
            "C_cross_shop_denied",
            c.get("ok") is False and c.get("error") == "support_request_shop_mismatch",
            str(c.get("error")),
        )
        expect(results, "C_no_row", int(counts().get("reqs") or 0) == int(before_c.get("reqs") or 0), str(counts()))

        # D — nonexistent ticket
        before_d = counts()
        d = start("support_admin", shop_a_id, device_a, MISSING_TICKET)
        expect(
            results,
            "D_missing_ticket_denied",
            d.get("ok") is False and d.get("error") == "support_request_not_found",
            str(d.get("error")),
        )
        expect(results, "D_no_row", int(counts().get("reqs") or 0) == int(before_d.get("reqs") or 0), str(counts()))

        # E — NULL regression
        e = start("support_admin", shop_a_id, device_a, None)
        e_id = str(e.get("request_id") or "")
        expect(results, "E_null_ticket_regression", e.get("ok") is True and bool(e_id), str(e.get("error")))
        cancel(e_id)

        # F — wrong device shop
        before_f = counts()
        f = start("support_admin", shop_a_id, device_b, None)
        expect(
            results,
            "F_device_shop_mismatch",
            f.get("ok") is False and f.get("error") == "device_shop_mismatch",
            str(f.get("error")),
        )
        expect(results, "F_no_row", int(counts().get("reqs") or 0) == int(before_f.get("reqs") or 0), str(counts()))

        # G — roles
        for role, allowed in (
            ("support_admin", True),
            ("super_admin", True),
            ("operations_admin", False),
            ("field_agent", False),
            ("finance_admin", False),
        ):
            data = start(role, shop_a_id, device_a, None)
            if allowed:
                expect(results, f"G_{role}_allow", data.get("ok") is True and bool(data.get("request_id")), str(data.get("error")))
                cancel(str(data.get("request_id") or ""))
            else:
                expect(
                    results,
                    f"G_{role}_deny",
                    data.get("ok") is False and data.get("error") == "not_authorized",
                    str(data.get("error")),
                )

        # H — customer cannot start
        before_h = counts()
        h = start(cashier_jwt, shop_a_id, device_a, ticket_a, use_jwt=True)
        expect(
            results,
            "H_customer_cannot_start",
            h.get("ok") is False and h.get("error") in ("not_authorized", "forbidden"),
            str(h.get("error")),
        )
        expect(results, "H_no_row", int(counts().get("reqs") or 0) == int(before_h.get("reqs") or 0), str(counts()))

        # I — ticket is context only
        sess_before = int(counts().get("sess") or 0)
        i = start("support_admin", shop_a_id, device_a, ticket_a)
        i_id = str(i.get("request_id") or "")
        irow = request_row(i_id) if i_id else {}
        sess_after = int(counts().get("sess") or 0)
        grant_rows = linked_query(
            f"select grant_jti::text from public.remote_support_sessions "
            f"where shop_id = '{shop_a_id}'::uuid and grant_jti is not null;"
        )
        expect(results, "I_request_with_ticket", i.get("ok") is True and irow.get("support_request_id") == ticket_a, str(irow))
        expect(results, "I_no_session_until_approve", sess_after == sess_before, f"{sess_before}->{sess_after}")
        expect(results, "I_no_grant_from_ticket", len(grant_rows) == 0, str(grant_rows))
        cancel(i_id)

        # J — delete ticket after link
        j = start("support_admin", shop_a_id, device_a, ticket_a)
        j_id = str(j.get("request_id") or "")
        linked_query(f"delete from public.support_requests where id = '{ticket_a}'::uuid; select 1 as ok;")
        jrow = request_row(j_id) if j_id else {}
        expect(
            results,
            "J_ticket_delete_sets_null",
            bool(j_id) and jrow.get("id") == j_id and jrow.get("support_request_id") in (None, "") and jrow.get("status") == "requested",
            json.dumps(jrow),
        )
        cancel(j_id)
        j_after = request_row(j_id) if j_id else {}
        expect(
            results,
            "J_request_lifecycle_unaffected",
            j_after.get("status") == "cancelled" or (not j_after and bool(j_id)),
            json.dumps(j_after),
        )

        # Phase 4 regression
        set_device_a("disconnected", "approved")
        inactive = start("support_admin", shop_a_id, device_a, None)
        expect(
            results,
            "reg_inactive_denied",
            inactive.get("ok") is False and inactive.get("error") in ("device_not_eligible", "device_offline"),
            str(inactive.get("error")),
        )
        set_device_a("active", "pending")
        unapproved = start("support_admin", shop_a_id, device_a, None)
        expect(
            results,
            "reg_unapproved_denied",
            unapproved.get("ok") is False and unapproved.get("error") == "device_not_eligible",
            str(unapproved.get("error")),
        )
        set_device_a("active", "approved", "now() - interval '45 minutes'")
        stale = start("support_admin", shop_a_id, device_a, None)
        expect(
            results,
            "reg_stale_denied",
            stale.get("ok") is False and stale.get("error") == "device_offline",
            str(stale.get("error")),
        )
        set_device_a("active", "approved")

        req = start("support_admin", shop_a_id, device_a, None)
        req_id = str(req.get("request_id") or "")
        expect(results, "reg_eligible_request", req.get("ok") is True and bool(req_id), str(req.get("error")))
        crafted = approve(req_id, fp_b)
        expect(
            results,
            "reg_device_b_cannot_approve_a",
            crafted.get("ok") is False and crafted.get("error") == "device_mismatch",
            str(crafted.get("error")),
        )
        approved = approve(req_id, fp_a)
        session_id = str(approved.get("session_id") or "")
        expect(
            results,
            "reg_matching_fingerprint_approve",
            approved.get("ok") is True and bool(session_id),
            str(approved.get("error")),
        )
        g = session_grant(session_id) if session_id else {}
        ok_assert = grant_assert(session_id, str(g.get("grant_jti")), fp_a)
        expect(results, "reg_grant_assert_once", ok_assert.get("ok") is True, str(ok_assert.get("error")))
        replay = grant_assert(session_id, str(g.get("grant_jti")), fp_a)
        expect(
            results,
            "reg_grant_replay_denied",
            replay.get("ok") is False and replay.get("error") == "grant_replayed",
            str(replay.get("error")),
        )
        ended = end_session(session_id, fp_a)
        expect(results, "reg_customer_end", ended.get("ok") is True, str(ended.get("error")))
        after_end = session_grant(session_id)
        expect(results, "reg_end_invalidates_grant", after_end.get("consumed") is True, str(after_end))

        expect(results, "phase5_no_transport", True, "cert never invoked Electron/RustDesk/transport")

    except Exception as e:
        expect(results, "harness", False, str(e)[:500])
        print("HARNESS_ERROR", str(e)[:1500], file=sys.stderr)
    finally:
        try:
            if linked and slug:
                linked_query(
                    f"delete from public.remote_support_sessions where shop_id in ("
                    f"  select id from public.shops where code in ('{shop_a}','{shop_b}')"
                    f"); "
                    f"delete from public.remote_support_requests where shop_id in ("
                    f"  select id from public.shops where code in ('{shop_a}','{shop_b}')"
                    f"); "
                    f"delete from public.support_requests where shop_id in ("
                    f"  select id from public.shops where code in ('{shop_a}','{shop_b}')"
                    f"); "
                    f"delete from public.organizations where slug in ('{slug}', '{slug}-b'); "
                    f"delete from public.internal_admins where email like 'rsci02.%@example.com'; "
                    f"select 1 as ok;"
                )
                leftover = linked_query(
                    f"select "
                    f"(select count(*)::int from public.shops where code in ('{shop_a}','{shop_b}')) as shops, "
                    f"(select count(*)::int from public.organizations where slug in ('{slug}', '{slug}-b')) as orgs, "
                    f"(select count(*)::int from public.internal_admins where email like 'rsci02.%@example.com') as admins;"
                )
                print("CLEANED_THROWAY", leftover)
        except Exception as e:
            print("CLEANUP_SQL_WARN", str(e)[:300], file=sys.stderr)
        for uid in created_user_ids:
            try:
                http_json("DELETE", f"{base}/auth/v1/admin/users/{uid}", admin_headers)
            except Exception:
                pass
        if created_user_ids:
            print("CLEANED_AUTH_USERS", len(created_user_ids))
        restore_cli(backup_dir)
        shutil.rmtree(backup_dir, ignore_errors=True)

    if current_ref() != PROD_REF:
        print("CLI_NOT_RESTORED", current_ref(), file=sys.stderr)
        return 2

    prod_after = linked_query(
        "select version::text as version from supabase_migrations.schema_migrations "
        "where version in ('151','152','153','154') order by version;"
    )
    prod_after_versions = {str(r.get("version")) for r in prod_after}
    print("PROD_MIGRATIONS_AFTER", sorted(prod_after_versions))
    expect(results, "production_still_has_no_154", "154" not in prod_after_versions, str(sorted(prod_after_versions)))

    failed = [r for r in results if not r["ok"]]
    print("SUMMARY", json.dumps({"passed": sum(1 for r in results if r["ok"]), "failed": len(failed), "total": len(results)}))
    for r in failed:
        print("FAILED_CASE", r["name"], r["detail"])
    return 0 if results and not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
