#!/usr/bin/env python3
"""RS-1.2 staging certification: apply 151+152 and exercise live RPCs.

Staging project only. Refuses production. Never prints secrets.
Temporarily links the Supabase CLI to staging, then restores production.
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
        raise RuntimeError(f"create user failed {code}: {user}")
    return str(user["id"])


def sign_in(base: str, anon: str, email: str, password: str) -> str:
    code, auth = http_json(
        "POST",
        f"{base}/auth/v1/token?grant_type=password",
        {"apikey": anon, "Content-Type": "application/json"},
        {"email": email, "password": password},
    )
    if code >= 400 or not isinstance(auth, dict) or not auth.get("access_token"):
        raise RuntimeError(f"sign-in failed {code}")
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


def rest_get(base: str, anon: str, token: str, path: str) -> tuple[int, object]:
    return http_json(
        "GET",
        f"{base}/rest/v1/{path}",
        {"apikey": anon, "Authorization": f"Bearer {token}"},
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
    backup_dir = Path(tempfile.mkdtemp(prefix="rs12-cli-"))
    linked = False

    try:
        for src in BACKUP_PATHS:
            if src.exists():
                shutil.copy2(src, backup_dir / src.name)

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

        applied = linked_query(
            "select version::text as version, coalesce(name,'') as name "
            "from supabase_migrations.schema_migrations "
            "where version in ('150','151','152') order by version;"
        )
        print("APPLIED", applied)
        versions = {str(r.get("version")) for r in applied}

        objects = linked_query(
            "select "
            "to_regclass('public.remote_support_requests') is not null as has_requests, "
            "exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname='public' and p.proname='_remote_support_device_is_eligible') as has_helper;"
        )
        print("OBJECTS_BEFORE", objects)

        if "151" not in versions:
            print("APPLYING 151")
            linked_file(ROOT / "supabase/migrations/151_remote_support_control_plane.sql")
            linked_query(
                "insert into supabase_migrations.schema_migrations (version, name) "
                "values ('151', 'remote_support_control_plane') "
                "on conflict (version) do nothing; select 1 as ok;"
            )
            print("APPLIED_151")
        else:
            print("SKIP_151 already applied")

        if "152" not in versions:
            print("APPLYING 152")
            linked_file(ROOT / "supabase/migrations/152_remote_support_security_hardening.sql")
            linked_query(
                "insert into supabase_migrations.schema_migrations (version, name) "
                "values ('152', 'remote_support_security_hardening') "
                "on conflict (version) do nothing; select 1 as ok;"
            )
            print("APPLIED_152")
        else:
            print("REAPPLYING_152_IDEMPOTENT")
            linked_file(ROOT / "supabase/migrations/152_remote_support_security_hardening.sql")
            print("REAPPLIED_152")

        after = linked_query(
            "select "
            "to_regclass('public.remote_support_requests') is not null as has_requests, "
            "exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname='public' and p.proname='_remote_support_device_is_eligible') as has_helper, "
            "(select count(*) from supabase_migrations.schema_migrations where version in ('151','152')) as n;"
        )
        print("OBJECTS_AFTER", after)
        if not after or not after[0].get("has_requests") or not after[0].get("has_helper"):
            raise RuntimeError("migrations did not create expected objects")

        token = secrets.token_hex(4)
        slug = f"rs12-{token}"
        shop_code = f"RS12{token[:4].upper()}"
        owner_email = f"rs12.owner.{token}@example.com"
        owner_pass = "Rs12Owner!" + secrets.token_hex(4)
        roles = {
            "support_admin": f"rs12.support.{token}@example.com",
            "super_admin": f"rs12.super.{token}@example.com",
            "operations_admin": f"rs12.ops.{token}@example.com",
            "field_agent": f"rs12.field.{token}@example.com",
            "finance_admin": f"rs12.finance.{token}@example.com",
        }
        role_pass = {role: f"Rs12{role[:4].title()}!" + secrets.token_hex(4) for role in roles}
        fp_a = f"rs12-pos-a-{token}"
        fp_b = f"rs12-pos-b-{token}"

        print("SEEDING", slug, shop_code)
        owner_id = create_user(base, admin_headers, owner_email, owner_pass, "RS12 Owner")
        created_user_ids.append(owner_id)
        role_ids: dict[str, str] = {}
        for role, email in roles.items():
            uid = create_user(base, admin_headers, email, role_pass[role], f"RS12 {role}")
            created_user_ids.append(uid)
            role_ids[role] = uid

        role_sql = ",\n".join(
            f"('{uid}'::uuid, '{uid}'::uuid, '{email}', '{role}', true)"
            for role, email, uid in ((r, roles[r], role_ids[r]) for r in roles)
        )
        seed = f"""
begin;
insert into public.profiles (id, full_name)
values
  ('{owner_id}'::uuid, 'RS12 Owner'),
  {", ".join(f"('{role_ids[r]}'::uuid, 'RS12 {r}')" for r in roles)}
on conflict (id) do update set full_name = excluded.full_name;

insert into public.internal_admins (user_id, auth_user_id, email, role, active)
values
{role_sql}
on conflict (user_id) do update
  set role = excluded.role, active = true, email = excluded.email, auth_user_id = excluded.auth_user_id;

with org as (
  insert into public.organizations (name, slug, created_by, phone_e164)
  values ('RS12 STAGING SHOP', '{slug}', '{owner_id}'::uuid, '+256700012001')
  returning id
),
om as (
  insert into public.organization_members (organization_id, user_id, role)
  select id, '{owner_id}'::uuid, 'owner' from org
  returning organization_id
),
shop as (
  insert into public.shops (organization_id, name, code, phone_e164, business_type, owner_user_id, is_active)
  select organization_id, 'RS12 TWO POS', '{shop_code}', '+256700012002', 'electronics', '{owner_id}'::uuid, true
  from om
  returning id
),
sm as (
  insert into public.shop_members (shop_id, user_id, role)
  select id, '{owner_id}'::uuid, 'owner' from shop
  returning shop_id
)
insert into public.shop_devices (
  shop_id, device_fingerprint, label, platform, last_seen_at, status, is_active,
  approval_status, device_type, form_factor, device_authority, is_primary
)
select shop_id, '{fp_a}', 'POS A', 'windows', now(), 'active'::public.shop_device_status, true, 'approved', 'windows_pos', 'windows', 'primary', true
from sm
union all
select shop_id, '{fp_b}', 'POS B', 'windows', now(), 'active'::public.shop_device_status, true, 'approved', 'windows_pos', 'windows', 'secondary', false
from sm;

commit;

select
  (select id::text from public.organizations where slug = '{slug}') as org_id,
  (select id::text from public.shops where code = '{shop_code}') as shop_id,
  (select d.id::text from public.shop_devices d join public.shops s on s.id = d.shop_id
    where s.code = '{shop_code}' and d.device_fingerprint = '{fp_a}') as device_a,
  (select d.id::text from public.shop_devices d join public.shops s on s.id = d.shop_id
    where s.code = '{shop_code}' and d.device_fingerprint = '{fp_b}') as device_b;
"""
        seed_rows = linked_query(seed)
        seed_row = seed_rows[0] if seed_rows else {}
        shop_id = seed_row.get("shop_id")
        device_a = seed_row.get("device_a")
        device_b = seed_row.get("device_b")
        org_id = seed_row.get("org_id")
        print("SEED", {"org": org_id, "shop": shop_id, "a": device_a, "b": device_b})
        if not shop_id or not device_a or not device_b:
            raise RuntimeError(f"seed incomplete: {seed_row}")

        tokens = {
            "owner": sign_in(base, anon, owner_email, owner_pass),
        }
        for role in roles:
            tokens[role] = sign_in(base, anon, roles[role], role_pass[role])

        def start(role: str) -> dict:
            code, data = rpc(
                base,
                anon,
                tokens[role],
                "remote_support_request_start",
                {
                    "p_shop_id": shop_id,
                    "p_shop_device_id": device_a,
                    "p_reason_code": "software",
                    "p_reason_text": "RS12 staging certification",
                },
            )
            data["_http"] = code
            return data

        def inbox(fp: str) -> dict:
            code, data = rpc(
                base, anon, tokens["owner"], "remote_support_customer_inbox", {"p_device_fingerprint": fp}
            )
            data["_http"] = code
            return data

        def approve(request_id: str, fp: str) -> dict:
            code, data = rpc(
                base,
                anon,
                tokens["owner"],
                "remote_support_customer_approve",
                {"p_request_id": request_id, "p_device_fingerprint": fp},
            )
            data["_http"] = code
            return data

        def end_session(session_id: str, fp: str) -> dict:
            code, data = rpc(
                base,
                anon,
                tokens["owner"],
                "remote_support_customer_end",
                {"p_session_id": session_id, "p_device_fingerprint": fp},
            )
            data["_http"] = code
            return data

        def cancel(request_id: str, role: str = "support_admin") -> dict:
            code, data = rpc(
                base, anon, tokens[role], "remote_support_technician_cancel", {"p_request_id": request_id}
            )
            data["_http"] = code
            return data

        def grant_assert(session_id: str, grant_jti: str, fp: str) -> dict:
            code, data = rpc(
                base,
                anon,
                tokens["owner"],
                "remote_support_grant_assert",
                {
                    "p_session_id": session_id,
                    "p_grant_jti": grant_jti,
                    "p_device_fingerprint": fp,
                },
            )
            data["_http"] = code
            return data

        def set_device(status: str, approval: str) -> None:
            linked_query(
                f"update public.shop_devices set status = '{status}'::public.shop_device_status, "
                f"approval_status = '{approval}', last_seen_at = now() "
                f"where id = '{device_a}'::uuid; select 1 as ok;"
            )

        def session_grant(session_id: str) -> dict:
            rows = linked_query(
                f"select id::text, status, grant_jti::text, grant_consumed_at is not null as consumed "
                f"from public.remote_support_sessions where id = '{session_id}'::uuid;"
            )
            return rows[0] if rows else {}

        # 6. Permissions first
        for role, allowed in (
            ("support_admin", True),
            ("super_admin", True),
            ("operations_admin", False),
            ("field_agent", False),
            ("finance_admin", False),
        ):
            data = start(role)
            if allowed:
                ok = data.get("ok") is True and bool(data.get("request_id"))
                expect(results, f"perm_{role}_request", ok, str(data.get("error") or data.get("status")))
                if data.get("request_id"):
                    cancel(str(data["request_id"]), role if role in ("support_admin", "super_admin") else "support_admin")
            else:
                ok = data.get("ok") is False and data.get("error") == "not_authorized"
                expect(results, f"perm_{role}_request_denied", ok, str(data.get("error")))

        # 1-3. Request, inbox A/B, crafted approve
        req = start("support_admin")
        request_id = str(req.get("request_id") or "")
        expect(results, "normal_request", req.get("ok") is True and bool(request_id), str(req.get("error")))

        inbox_a = inbox(fp_a)
        inbox_b = inbox(fp_b)
        seen_a = bool((inbox_a.get("request") or {}).get("id"))
        seen_b = bool((inbox_b.get("request") or {}).get("id"))
        expect(results, "inbox_pos_a_sees", seen_a and str((inbox_a.get("request") or {}).get("id")) == request_id)
        expect(results, "inbox_pos_b_hidden", not seen_b, json.dumps(inbox_b.get("request")))
        expect(
            results,
            "inbox_no_grant_jti",
            "grant_jti" not in json.dumps(inbox_a),
            "inbox leaked grant_jti" if "grant_jti" in json.dumps(inbox_a) else "",
        )

        crafted = approve(request_id, fp_b)
        expect(
            results,
            "crafted_approve_denied",
            crafted.get("ok") is False and crafted.get("error") == "device_mismatch",
            str(crafted.get("error")),
        )

        approved = approve(request_id, fp_a)
        session_id = str(approved.get("session_id") or "")
        expect(
            results,
            "normal_approve",
            approved.get("ok") is True and approved.get("status") == "approved" and bool(session_id),
            str(approved.get("error") or approved.get("status")),
        )
        expect(results, "approve_no_grant_jti", "grant_jti" not in approved, str(approved.keys()))

        sess = session_grant(session_id) if session_id else {}
        expect(results, "session_connecting", sess.get("status") == "connecting", str(sess.get("status")))

        # Shop-member / ops SELECT leakage
        code, rows = rest_get(base, anon, tokens["owner"], "remote_support_requests?select=id,device_fingerprint")
        leaked = isinstance(rows, list) and len(rows) > 0
        expect(results, "shop_member_cannot_select_requests", code in (200, 206) and not leaked, f"http={code} n={len(rows) if isinstance(rows, list) else rows}")

        code, rows = rest_get(base, anon, tokens["operations_admin"], "remote_support_sessions?select=id,status,grant_jti")
        ops_leaked = isinstance(rows, list) and len(rows) > 0
        expect(results, "ops_admin_cannot_select_sessions", (code in (200, 206) and not ops_leaked) or code >= 400, f"http={code}")

        code, rows = rest_get(base, anon, tokens["support_admin"], "remote_support_sessions?select=grant_jti")
        leaked_jti = False
        if isinstance(rows, list):
            leaked_jti = any(isinstance(r, dict) and r.get("grant_jti") not in (None, "") for r in rows)
        elif isinstance(rows, dict) and rows.get("grant_jti"):
            leaked_jti = True
        expect(
            results,
            "grant_jti_column_not_selectable",
            code >= 400 and not leaked_jti,
            f"http={code} leaked={leaked_jti}",
        )

        # 7. Customer end invalidates grant
        ended = end_session(session_id, fp_a)
        expect(results, "customer_end", ended.get("ok") is True and ended.get("status") == "ended", str(ended.get("error")))
        after_end = session_grant(session_id)
        expect(results, "end_invalidates_grant", after_end.get("consumed") is True, str(after_end))
        replay_after_end = grant_assert(session_id, str(after_end.get("grant_jti") or "00000000-0000-0000-0000-000000000000"), fp_a)
        expect(
            results,
            "assert_after_end_denied",
            replay_after_end.get("ok") is False,
            str(replay_after_end.get("error")),
        )

        # 4. Revoke before approval
        req2 = start("support_admin")
        request2 = str(req2.get("request_id") or "")
        expect(results, "request_before_revoke", req2.get("ok") is True, str(req2.get("error")))
        set_device("revoked", "revoked")
        denied_approve = approve(request2, fp_a)
        expect(
            results,
            "approve_after_revoke_denied",
            denied_approve.get("ok") is False
            and denied_approve.get("error") in ("device_no_longer_eligible", "request_expired"),
            str(denied_approve.get("error")),
        )

        # 5. Revoke after approval, then grant assert
        set_device("active", "approved")
        req3 = start("support_admin")
        request3 = str(req3.get("request_id") or "")
        expect(results, "request_after_restore", req3.get("ok") is True, str(req3.get("error")))
        ap3 = approve(request3, fp_a)
        session3 = str(ap3.get("session_id") or "")
        expect(results, "approve_after_restore", ap3.get("ok") is True, str(ap3.get("error")))
        g3 = session_grant(session3)
        set_device("revoked", "revoked")
        denied_assert = grant_assert(session3, str(g3.get("grant_jti")), fp_a)
        expect(
            results,
            "assert_after_revoke_denied",
            denied_assert.get("ok") is False and denied_assert.get("error") == "device_no_longer_eligible",
            str(denied_assert.get("error")),
        )
        after_rev = session_grant(session3)
        expect(results, "session_revoked_after_device_revoke", after_rev.get("status") == "revoked", str(after_rev.get("status")))

        # Bonus: valid grant + eligible device succeeds, replay fails
        set_device("active", "approved")
        req4 = start("support_admin")
        ap4 = approve(str(req4.get("request_id")), fp_a)
        session4 = str(ap4.get("session_id") or "")
        g4 = session_grant(session4)
        ok_assert = grant_assert(session4, str(g4.get("grant_jti")), fp_a)
        expect(results, "assert_valid_grant", ok_assert.get("ok") is True, str(ok_assert.get("error") or ok_assert.get("status")))
        replay = grant_assert(session4, str(g4.get("grant_jti")), fp_a)
        expect(results, "assert_replay_denied", replay.get("ok") is False and replay.get("error") == "grant_replayed", str(replay.get("error")))
        end_session(session4, fp_a)

        # Cascade: deleting the device must remove RS rows
        before = linked_query(
            f"select "
            f"(select count(*) from public.remote_support_requests where shop_device_id = '{device_b}'::uuid) as reqs, "
            f"(select count(*) from public.remote_support_sessions where shop_device_id = '{device_b}'::uuid) as sess;"
        )
        # create a request on B then delete B
        code, req_b = rpc(
            base,
            anon,
            tokens["support_admin"],
            "remote_support_request_start",
            {
                "p_shop_id": shop_id,
                "p_shop_device_id": device_b,
                "p_reason_code": "hardware",
                "p_reason_text": "RS12 cascade check",
            },
        )
        expect(results, "request_pos_b_for_cascade", req_b.get("ok") is True, str(req_b.get("error")))
        linked_query(f"delete from public.shop_devices where id = '{device_b}'::uuid; select 1 as ok;")
        after_del = linked_query(
            f"select "
            f"(select count(*) from public.remote_support_requests where shop_id = '{shop_id}'::uuid and device_fingerprint = '{fp_b}') as reqs, "
            f"(select count(*) from public.remote_support_sessions where shop_id = '{shop_id}'::uuid and shop_device_id = '{device_b}'::uuid) as sess;"
        )
        expect(
            results,
            "device_delete_cascades_rs_rows",
            int((after_del[0] or {}).get("reqs") or 0) == 0 and int((after_del[0] or {}).get("sess") or 0) == 0,
            str(after_del),
        )
        _ = before

    except Exception as e:
        expect(results, "harness", False, str(e)[:500])
        print("HARNESS_ERROR", str(e)[:1500], file=sys.stderr)
    finally:
        try:
            if linked and slug:
                linked_query(
                    f"delete from public.organizations where slug = '{slug}'; "
                    f"delete from public.internal_admins where email like 'rs12.%@example.com'; "
                    f"select 1 as ok;"
                )
                print("CLEANED_THROWAY", slug)
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

    failed = [r for r in results if not r["ok"]]
    print("SUMMARY", json.dumps({"passed": sum(1 for r in results if r["ok"]), "failed": len(failed), "total": len(results)}))
    for r in failed:
        print("FAILED_CASE", r["name"], r["detail"])
    return 0 if results and not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
