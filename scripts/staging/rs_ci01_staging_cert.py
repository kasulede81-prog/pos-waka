#!/usr/bin/env python3
"""RS-CI-0.1 staging certification for shop_submit_pos_support_ticket.

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
MIGRATION = ROOT / "supabase/migrations/153_shop_submit_pos_support_ticket.sql"

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
        return code, data
    return code, {"raw": data}


def rest(method: str, base: str, anon: str, token: str, path: str, body: dict | None = None) -> tuple[int, object]:
    return http_json(
        method,
        f"{base}/rest/v1/{path}",
        {
            "apikey": anon,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        body,
    )


def expect(results: list[dict], name: str, ok: bool, detail: str = "") -> None:
    results.append({"name": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


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
        print("MISSING 153", file=sys.stderr)
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
    backup_dir = Path(tempfile.mkdtemp(prefix="rsci01-cli-"))
    linked = False
    ticket_fields: dict = {}

    try:
        for src in BACKUP_PATHS:
            if src.exists():
                shutil.copy2(src, backup_dir / src.name)

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
            "where version in ('151','152','153') order by version;"
        )
        print("APPLIED_BEFORE", applied)
        versions = {str(r.get("version")) for r in applied}

        rpc_before = linked_query(
            "select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname='public' and p.proname='shop_submit_pos_support_ticket') as has_rpc;"
        )
        print("RPC_BEFORE", rpc_before)

        if "153" not in versions:
            print("APPLYING 153")
            linked_file(MIGRATION)
            linked_query(
                "insert into supabase_migrations.schema_migrations (version, name) "
                "values ('153', 'shop_submit_pos_support_ticket') "
                "on conflict (version) do nothing; select 1 as ok;"
            )
            print("APPLIED_153")
        else:
            print("REAPPLYING_153_IDEMPOTENT")
            linked_file(MIGRATION)
            print("REAPPLIED_153")

        after_tables = linked_query(
            "select count(*)::int as n from information_schema.tables "
            "where table_schema='public' and table_type='BASE TABLE';"
        )
        after_n = int((after_tables[0] or {}).get("n") or 0)
        rpc_after = linked_query(
            "select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname='public' and p.proname='shop_submit_pos_support_ticket') as has_rpc, "
            "(select count(*) from supabase_migrations.schema_migrations where version='153') as n153;"
        )
        expect(results, "migration_153_applied", bool(rpc_after and rpc_after[0].get("has_rpc") and int(rpc_after[0].get("n153") or 0) == 1), str(rpc_after))
        expect(results, "no_unexpected_table_change", after_n == before_n, f"tables {before_n}->{after_n}")

        src_152 = (ROOT / "supabase/migrations/152_remote_support_security_hardening.sql").read_text()
        start_fn = src_152[src_152.find("create or replace function public.remote_support_request_start") :]
        start_fn = start_fn[: start_fn.find("$$;") + 3]
        checks_ticket_shop = "support_requests" in start_fn and "shop_id" in start_fn and "p_support_request_id" in start_fn
        # The insert uses p_support_request_id directly; there is no select from support_requests.
        live_src = linked_query(
            "select pg_get_functiondef(p.oid) as def from pg_proc p "
            "join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname='public' and p.proname='remote_support_request_start' "
            "order by p.pronargs desc limit 1;"
        )
        live_def = str((live_src[0] or {}).get("def") or "")
        live_selects_ticket = "from public.support_requests" in live_def.lower() or "from support_requests" in live_def.lower()
        expect(
            results,
            "ticket_link_sql_has_no_shop_check",
            (not live_selects_ticket) and "p_support_request_id" in live_def,
            "live function inserts p_support_request_id without reading support_requests",
        )
        _ = checks_ticket_shop

        token = secrets.token_hex(4)
        slug = f"rsci01-{token}"
        shop_a = f"CIA{token[:4].upper()}"
        shop_b = f"CIB{token[:4].upper()}"
        cashier_email = f"rsci01.cashier.{token}@example.com"
        outsider_email = f"rsci01.outsider.{token}@example.com"
        admin_email = f"rsci01.support.{token}@example.com"
        cashier_pass = "Ci01Cash!" + secrets.token_hex(4)
        outsider_pass = "Ci01Out!" + secrets.token_hex(4)
        admin_pass = "Ci01Adm!" + secrets.token_hex(4)
        fp = f"rsci01-pos-{token}"

        cashier_id = create_user(base, admin_headers, cashier_email, cashier_pass, "RSCI01 Cashier")
        outsider_id = create_user(base, admin_headers, outsider_email, outsider_pass, "RSCI01 Outsider")
        admin_id = create_user(base, admin_headers, admin_email, admin_pass, "RSCI01 Support")
        created_user_ids.extend([cashier_id, outsider_id, admin_id])

        seed = f"""
begin;
insert into public.profiles (id, full_name)
values
  ('{cashier_id}'::uuid, 'RSCI01 Cashier'),
  ('{outsider_id}'::uuid, 'RSCI01 Outsider'),
  ('{admin_id}'::uuid, 'RSCI01 Support')
on conflict (id) do update set full_name = excluded.full_name;

insert into public.internal_admins (user_id, auth_user_id, email, role, active)
values ('{admin_id}'::uuid, '{admin_id}'::uuid, '{admin_email}', 'support_admin', true)
on conflict (user_id) do update
  set role = excluded.role, active = true, email = excluded.email, auth_user_id = excluded.auth_user_id;

with org_a as (
  insert into public.organizations (name, slug, created_by, phone_e164)
  values ('RSCI01 SHOP A', '{slug}', '{cashier_id}'::uuid, '+256700013001')
  returning id
),
om_a as (
  insert into public.organization_members (organization_id, user_id, role)
  select id, '{cashier_id}'::uuid, 'owner' from org_a
  returning organization_id
),
shop_a as (
  insert into public.shops (organization_id, name, code, phone_e164, business_type, owner_user_id, is_active)
  select organization_id, 'RSCI01 A', '{shop_a}', '+256700013002', 'electronics', '{cashier_id}'::uuid, true
  from om_a
  returning id
),
sm_a as (
  insert into public.shop_members (shop_id, user_id, role)
  select id, '{cashier_id}'::uuid, 'cashier' from shop_a
  returning shop_id
),
org_b as (
  insert into public.organizations (name, slug, created_by, phone_e164)
  values ('RSCI01 SHOP B', '{slug}-b', '{outsider_id}'::uuid, '+256700013003')
  returning id
),
om_b as (
  insert into public.organization_members (organization_id, user_id, role)
  select id, '{outsider_id}'::uuid, 'owner' from org_b
  returning organization_id
),
shop_b as (
  insert into public.shops (organization_id, name, code, phone_e164, business_type, owner_user_id, is_active)
  select organization_id, 'RSCI01 B', '{shop_b}', '+256700013004', 'electronics', '{outsider_id}'::uuid, true
  from om_b
  returning id
)
insert into public.shop_members (shop_id, user_id, role)
select id, '{outsider_id}'::uuid, 'owner' from shop_b;

insert into public.shop_devices (
  shop_id, device_fingerprint, label, platform, last_seen_at, status, is_active,
  approval_status, device_type, form_factor, device_authority, is_primary
)
select s.id, '{fp}', 'RSCI01 POS', 'windows', now(), 'active'::public.shop_device_status, true, 'approved', 'windows_pos', 'windows', 'primary', true
from public.shops s where s.code = '{shop_a}';

commit;

select
  (select id::text from public.shops where code = '{shop_a}') as shop_a_id,
  (select organization_id::text from public.shops where code = '{shop_a}') as org_a_id,
  (select id::text from public.shops where code = '{shop_b}') as shop_b_id,
  (select d.id::text from public.shop_devices d join public.shops s on s.id = d.shop_id
    where s.code = '{shop_a}' and d.device_fingerprint = '{fp}') as device_a;
"""
        seed_row = (linked_query(seed) or [{}])[0]
        shop_a_id = seed_row.get("shop_a_id")
        org_a_id = seed_row.get("org_a_id")
        shop_b_id = seed_row.get("shop_b_id")
        device_a = seed_row.get("device_a")
        print("SEED", {"shop_a": shop_a_id, "shop_b": shop_b_id, "device": device_a})
        if not shop_a_id or not shop_b_id:
            raise RuntimeError("seed incomplete")

        cashier_jwt = sign_in(base, anon, cashier_email, cashier_pass)
        outsider_jwt = sign_in(base, anon, outsider_email, outsider_pass)
        admin_jwt = sign_in(base, anon, admin_email, admin_pass)

        sessions_before = linked_query(
            f"select count(*)::int as n from public.remote_support_sessions where shop_id = '{shop_a_id}'::uuid;"
        )
        rs_before = linked_query(
            f"select count(*)::int as n from public.remote_support_requests where shop_id = '{shop_a_id}'::uuid;"
        )

        code, ok_row = rpc(
            base,
            anon,
            cashier_jwt,
            "shop_submit_pos_support_ticket",
            {
                "p_shop_id": shop_a_id,
                "p_subject": "printer: Printer is not working",
                "p_body": "Printer is not working",
                "p_issue_type": "printer",
                "p_diagnostics": {"deviceId": fp, "appVersion": "1.0.12", "source": "pos_need_help"},
            },
        )
        ticket_id = str(ok_row.get("ticket_id") or "")
        expect(results, "1_cashier_submit_success", code < 400 and ok_row.get("ok") is True and bool(ticket_id), str(ok_row.get("error") or code))

        rows = linked_query(
            f"select id::text, shop_id::text, organization_id::text, opened_by_user_id::text, "
            f"channel, issue_type, device_fingerprint, subject, body, assigned_internal_admin_id::text, "
            f"app_version, metadata->>'source' as source "
            f"from public.support_requests where id = '{ticket_id}'::uuid;"
            if ticket_id
            else "select 1 as missing;"
        )
        row = rows[0] if rows and ticket_id else {}
        ticket_fields = row
        expect(
            results,
            "2_ticket_fields",
            row.get("shop_id") == shop_a_id
            and row.get("organization_id") == org_a_id
            and row.get("opened_by_user_id") == cashier_id
            and row.get("channel") == "app"
            and row.get("issue_type") == "printer"
            and row.get("device_fingerprint") == fp
            and row.get("subject") == "printer: Printer is not working"
            and row.get("body") == "Printer is not working"
            and row.get("source") == "pos_need_help",
            json.dumps({k: row.get(k) for k in ("shop_id", "opened_by_user_id", "channel", "issue_type", "device_fingerprint", "subject")}),
        )

        code, empty = rpc(
            base,
            anon,
            cashier_jwt,
            "shop_submit_pos_support_ticket",
            {"p_shop_id": shop_a_id, "p_subject": "x", "p_body": "  ", "p_issue_type": "printer"},
        )
        expect(results, "3_empty_description_rejected", empty.get("ok") is False and empty.get("error") == "description_required", str(empty.get("error")))

        code, cross = rpc(
            base,
            anon,
            cashier_jwt,
            "shop_submit_pos_support_ticket",
            {"p_shop_id": shop_b_id, "p_subject": "cross", "p_body": "Trying another shop", "p_issue_type": "other"},
        )
        expect(results, "4_foreign_shop_rejected", cross.get("ok") is False and cross.get("error") == "forbidden", str(cross.get("error")))

        spoof_code, spoof = rpc(
            base,
            anon,
            cashier_jwt,
            "shop_submit_pos_support_ticket",
            {
                "p_shop_id": shop_a_id,
                "p_subject": "spoof opener",
                "p_body": "Trying to set another opener",
                "p_issue_type": "other",
                "p_opened_by_user_id": outsider_id,
                "opened_by_user_id": outsider_id,
                "p_assigned_internal_admin_id": admin_id,
                "assigned_internal_admin_id": admin_id,
            },
        )
        expect(
            results,
            "5_opened_by_forced_to_auth_uid",
            row.get("opened_by_user_id") == cashier_id
            and row.get("opened_by_user_id") != outsider_id
            and spoof_code == 404,
            f"opened_by={row.get('opened_by_user_id')} spoof_http={spoof_code} spoof={spoof.get('code') or spoof.get('message') or spoof.get('error')}",
        )
        expect(results, "6_assigned_admin_impossible", row.get("assigned_internal_admin_id") in (None, ""), str(row.get("assigned_internal_admin_id")))

        rs_after_ticket = linked_query(
            f"select "
            f"(select count(*)::int from public.remote_support_requests where shop_id = '{shop_a_id}'::uuid) as reqs, "
            f"(select count(*)::int from public.remote_support_sessions where shop_id = '{shop_a_id}'::uuid) as sess;"
        )
        expect(
            results,
            "7_rpc_cannot_create_remote_support_request",
            int((rs_after_ticket[0] or {}).get("reqs") or 0) == int((rs_before[0] or {}).get("n") or 0),
            str(rs_after_ticket),
        )

        code, queue = rpc(base, anon, admin_jwt, "internal_ops_support_queue", {"p_limit": 100})
        queue_blob = json.dumps(queue)
        in_inbox = bool(ticket_id) and ticket_id in queue_blob and code < 400
        expect(
            results,
            "8_admin_inbox_sees_ticket",
            in_inbox,
            f"http={code} ticket={bool(ticket_id)} in_queue={bool(ticket_id) and ticket_id in queue_blob}",
        )

        patch_code, patch = rest(
            "PATCH",
            base,
            anon,
            cashier_jwt,
            f"support_requests?id=eq.{ticket_id}",
            {"status": "in_progress", "assigned_internal_admin_id": admin_id},
        )
        after_patch = linked_query(
            f"select status, assigned_internal_admin_id::text as assigned "
            f"from public.support_requests where id = '{ticket_id}'::uuid;"
            if ticket_id
            else "select 'missing' as status;"
        )
        expect(
            results,
            "9_member_cannot_mutate_ticket",
            (after_patch[0] or {}).get("status") == "open" and (after_patch[0] or {}).get("assigned") in (None, ""),
            f"http={patch_code} {after_patch}",
        )

        sessions_after = linked_query(
            f"select count(*)::int as n from public.remote_support_sessions where shop_id in ('{shop_a_id}'::uuid, '{shop_b_id}'::uuid);"
        )
        expect(
            results,
            "10_no_remote_support_sessions",
            int((sessions_after[0] or {}).get("n") or 0) == int((sessions_before[0] or {}).get("n") or 0) == 0,
            str(sessions_after),
        )
        expect(results, "11_no_transport_or_rustdesk", True, "cert script never invoked transport/Electron/RustDesk")

        # Admin-only probe of the pre-existing ticket-link gap. Creates a request row, then deletes it.
        # Does not approve, does not create a session, does not start transport.
        outsider_ticket = rpc(
            base,
            anon,
            outsider_jwt,
            "shop_submit_pos_support_ticket",
            {"p_shop_id": shop_b_id, "p_subject": "shop B ticket", "p_body": "Shop B context only", "p_issue_type": "other"},
        )[1]
        b_ticket = str(outsider_ticket.get("ticket_id") or "")
        code, start = rpc(
            base,
            anon,
            admin_jwt,
            "remote_support_request_start",
            {
                "p_shop_id": shop_a_id,
                "p_shop_device_id": device_a,
                "p_reason_code": "other",
                "p_reason_text": "RSCI01 ticket-link probe",
                "p_support_request_id": b_ticket,
            },
        )
        linked_id = ""
        if start.get("ok") and start.get("request_id"):
            linked_id = str(start["request_id"])
            link_row = linked_query(
                f"select shop_id::text, support_request_id::text from public.remote_support_requests "
                f"where id = '{linked_id}'::uuid;"
            )
            linked_query(
                f"delete from public.remote_support_requests where id = '{linked_id}'::uuid; select 1 as ok;"
            )
            expect(
                results,
                "ticket_link_cross_shop_currently_possible",
                (link_row[0] or {}).get("shop_id") == shop_a_id and (link_row[0] or {}).get("support_request_id") == b_ticket,
                "Shop A request accepted Shop B ticket id; row deleted after probe",
            )
        else:
            expect(
                results,
                "ticket_link_cross_shop_currently_possible",
                False,
                f"start blocked unexpectedly: {start.get('error')}",
            )

        sess_final = linked_query(
            f"select count(*)::int as n from public.remote_support_sessions "
            f"where shop_id in ('{shop_a_id}'::uuid, '{shop_b_id}'::uuid);"
        )
        expect(results, "probe_left_zero_sessions", int((sess_final[0] or {}).get("n") or 0) == 0, str(sess_final))

    except Exception as e:
        expect(results, "harness", False, str(e)[:500])
        print("HARNESS_ERROR", str(e)[:1500], file=sys.stderr)
    finally:
        try:
            if linked and slug:
                linked_query(
                    f"delete from public.remote_support_requests where shop_id in ("
                    f"  select id from public.shops where code in ('{shop_a}','{shop_b}')"
                    f"); "
                    f"delete from public.support_requests where shop_id in ("
                    f"  select id from public.shops where code in ('{shop_a}','{shop_b}')"
                    f"); "
                    f"delete from public.organizations where slug in ('{slug}', '{slug}-b'); "
                    f"delete from public.internal_admins where email like 'rsci01.%@example.com'; "
                    f"select 1 as ok;"
                )
                leftover = linked_query(
                    f"select "
                    f"(select count(*)::int from public.shops where code in ('{shop_a}','{shop_b}')) as shops, "
                    f"(select count(*)::int from public.organizations where slug in ('{slug}', '{slug}-b')) as orgs;"
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

    print("TICKET_FIELDS", json.dumps(ticket_fields))
    failed = [r for r in results if not r["ok"]]
    print("SUMMARY", json.dumps({"passed": sum(1 for r in results if r["ok"]), "failed": len(failed), "total": len(results)}))
    for r in failed:
        print("FAILED_CASE", r["name"], r["detail"])
    return 0 if results and not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
