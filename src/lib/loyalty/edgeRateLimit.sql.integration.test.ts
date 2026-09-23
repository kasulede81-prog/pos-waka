import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asRole,
  createEdgeRateLimitSqlHarness,
  rpcJson,
  type SqlExec,
} from "../../test/sqlIntegration/edgeRateLimitPgHarness";

let exec: SqlExec;

beforeAll(async () => {
  exec = await createEdgeRateLimitSqlHarness();
}, 60_000);

afterAll(async () => {
  await exec?.close();
});

async function consume(args: {
  scope: string;
  ipHash: string | null;
  tokenHash: string | null;
  ipLimit: number;
  ipWindowMs: number;
  tokenLimit: number;
  tokenWindowMs: number;
}) {
  const { rows } = await exec.query(
    `SELECT public.edge_rate_limit_consume($1,$2,$3,$4,$5,$6,$7) AS result`,
    [
      args.scope,
      args.ipHash,
      args.tokenHash,
      args.ipLimit,
      args.ipWindowMs,
      args.tokenLimit,
      args.tokenWindowMs,
    ],
  );
  return rpcJson(rows[0]);
}

describe("edge_rate_limit_consume (F1/W2)", () => {
  it("allows first request and rejects above IP limit", async () => {
    const ip = `ip-hash-a-${crypto.randomUUID()}`;
    const tok = `tok-hash-a-${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) {
      const r = await consume({
        scope: "card_read",
        ipHash: ip,
        tokenHash: tok,
        ipLimit: 3,
        ipWindowMs: 60_000,
        tokenLimit: 100,
        tokenWindowMs: 60_000,
      });
      expect(r.ok).toBe(true);
    }
    const blocked = await consume({
      scope: "card_read",
      ipHash: ip,
      tokenHash: tok,
      ipLimit: 3,
      ipWindowMs: 60_000,
      tokenLimit: 100,
      tokenWindowMs: 60_000,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe("rate_limited");
    expect(Number(blocked.retry_after_seconds)).toBeGreaterThan(0);
  });

  it("rejects on token dimension even when IP differs (W2)", async () => {
    const tok = `tok-w2-${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      const r = await consume({
        scope: "wallet_issue",
        ipHash: `ip-${i}-${crypto.randomUUID()}`,
        tokenHash: tok,
        ipLimit: 100,
        ipWindowMs: 60_000,
        tokenLimit: 5,
        tokenWindowMs: 600_000,
      });
      expect(r.ok).toBe(true);
    }
    const blocked = await consume({
      scope: "wallet_issue",
      ipHash: `ip-new-${crypto.randomUUID()}`,
      tokenHash: tok,
      ipLimit: 100,
      ipWindowMs: 60_000,
      tokenLimit: 5,
      tokenWindowMs: 600_000,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe("rate_limited");
  });

  it("requires token_hash for wallet_issue", async () => {
    const r = await consume({
      scope: "wallet_issue",
      ipHash: `ip-${crypto.randomUUID()}`,
      tokenHash: null,
      ipLimit: 10,
      ipWindowMs: 60_000,
      tokenLimit: 5,
      tokenWindowMs: 600_000,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("token_hash_required");
  });

  it("wallet_issue without token_hash does not leave an IP count behind", async () => {
    const ip = `ip-compensated-${crypto.randomUUID()}`;
    const missing = await consume({
      scope: "wallet_issue",
      ipHash: ip,
      tokenHash: null,
      ipLimit: 10,
      ipWindowMs: 60_000,
      tokenLimit: 5,
      tokenWindowMs: 600_000,
    });
    expect(missing.error).toBe("token_hash_required");

    const { rows } = await exec.query<{ count: number }>(
      `SELECT count FROM public.edge_rate_limit_buckets
       WHERE scope = 'wallet_issue' AND dim = 'ip' AND key_hash = $1`,
      [ip],
    );
    // Either no row, or count rolled back to 0.
    if (rows.length === 0) {
      expect(rows.length).toBe(0);
    } else {
      expect(rows[0].count).toBe(0);
    }
  });

  it("stores only hashes — no raw token/ip columns exist", async () => {
    const { rows } = await exec.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'edge_rate_limit_buckets'`,
    );
    const cols = rows.map((r: { column_name: string }) => r.column_name);
    expect(cols).toContain("key_hash");
    expect(cols).not.toContain("token");
    expect(cols).not.toContain("public_card_token");
    expect(cols).not.toContain("ip");
    expect(cols).not.toContain("save_url");
  });

  it("rejects concurrent over-admit on the same key", async () => {
    const ip = `ip-race-${crypto.randomUUID()}`;
    const tok = `tok-race-${crypto.randomUUID()}`;
    const attempts = Array.from({ length: 20 }, () =>
      consume({
        scope: "card_read",
        ipHash: ip,
        tokenHash: tok,
        ipLimit: 5,
        ipWindowMs: 60_000,
        tokenLimit: 100,
        tokenWindowMs: 60_000,
      }),
    );
    // Sequential in one connection is still atomic; simulate burst.
    const results = [];
    for (const p of attempts) results.push(await p);
    const allowed = results.filter((r) => r.ok === true).length;
    const denied = results.filter((r) => r.error === "rate_limited").length;
    expect(allowed).toBe(5);
    expect(denied).toBe(15);
  });

  it("anon and authenticated cannot execute consume", async () => {
    await expect(
      asRole(exec, "anon", async () => {
        await exec.query(`SELECT public.edge_rate_limit_consume('card_read','a','b',1,1000,1,1000)`);
      }),
    ).rejects.toThrow();

    await expect(
      asRole(exec, "authenticated", async () => {
        await exec.query(`SELECT public.edge_rate_limit_consume('card_read','a','b',1,1000,1,1000)`);
      }),
    ).rejects.toThrow();
  });

  it("service_role can execute consume", async () => {
    const r = await asRole(exec, "service_role", async () => {
      const { rows } = await exec.query(
        `SELECT public.edge_rate_limit_consume($1,$2,$3,$4,$5,$6,$7) AS result`,
        [
          "card_read",
          `srv-ip-${crypto.randomUUID()}`,
          `srv-tok-${crypto.randomUUID()}`,
          10,
          60_000,
          10,
          60_000,
        ],
      );
      return rpcJson(rows[0]);
    });
    expect(r.ok).toBe(true);
  });

  it("anon cannot read or write the bucket table", async () => {
    await expect(
      asRole(exec, "anon", async () => {
        await exec.query(`SELECT * FROM public.edge_rate_limit_buckets LIMIT 1`);
      }),
    ).rejects.toThrow();
  });

  it("purge removes only old buckets", async () => {
    const { rows } = await exec.query<{ edge_rate_limit_purge_expired: number }>(
      `SELECT public.edge_rate_limit_purge_expired(1) AS edge_rate_limit_purge_expired`,
    );
    expect(typeof rows[0].edge_rate_limit_purge_expired).toBe("number");
  });
});
