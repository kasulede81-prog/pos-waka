#!/usr/bin/env python3
"""Read-only probe of WAKA staging migration state. Refuses production. Prints no secrets."""

from __future__ import annotations

import subprocess
import sys
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


def main() -> int:
    if not ENV_PATH.exists():
        print("MISSING staging env", file=sys.stderr)
        return 1
    env = load_env()
    ref = env.get("STAGING_PROJECT_REF", "")
    url = env.get("STAGING_SUPABASE_URL", "")
    db = env.get("STAGING_DB_URL", "")
    if ref != STAGING_REF or ref == PROD_REF:
        print("REFUSING: not staging", file=sys.stderr)
        return 1
    if PROD_REF in url or PROD_REF in db:
        print("REFUSING: URL looks like production", file=sys.stderr)
        return 1
    if STAGING_REF not in url:
        print("REFUSING: URL is not staging project", file=sys.stderr)
        return 1

    sql = r"""
    select version, name
    from supabase_migrations.schema_migrations
    where version ~ '^(14[6-9]|15[0-9])'
    order by version;
    """
    def query(sql_text: str) -> str:
        envp = dict(__import__("os").environ)
        envp["SEND_EMAIL_HOOK_SECRET"] = envp.get(
            "SEND_EMAIL_HOOK_SECRET",
            "v1,whsec_dGVzdF9zZWNyZXRfZm9yX2NsaV9jb25maWdfb25seV8xMjM",
        )
        proc = subprocess.run(
            [
                "npx",
                "supabase",
                "db",
                "query",
                "--db-url",
                db,
                "--dns-resolver",
                "https",
                "-o",
                "json",
                sql_text,
            ],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            env=envp,
        )
        if proc.returncode != 0:
            raise RuntimeError((proc.stderr or proc.stdout)[-2500:])
        return proc.stdout

    print("STAGING_REF", STAGING_REF)
    print("MIGRATIONS_146_PLUS")
    print(query(sql))
    sql2 = r"""
    select
      to_regclass('public.remote_support_requests') is not null as has_requests,
      to_regclass('public.remote_support_sessions') is not null as has_sessions,
      exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='_remote_support_device_is_eligible') as has_eligible_helper,
      exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='remote_support_customer_approve') as has_approve;
    """
    print("OBJECTS")
    print(query(sql2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
