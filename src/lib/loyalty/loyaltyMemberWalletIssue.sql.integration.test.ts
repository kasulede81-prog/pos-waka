import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  asAnon,
  asUser,
  createLoyaltySqlHarness,
  enableProgram,
  rpcJson,
  seedLoyaltyFixture,
  type LoyaltyFixture,
  type SqlExec,
} from "../../test/sqlIntegration/loyaltyPgHarness";

/**
 * MEMBER-SCOPED GOOGLE WALLET AUTHORITY.
 *
 * THE AUTHORITY IS THE SESSION, NOT A PARAMETER. `loyalty_member_wallet_account(shop)` takes a
 * SHOP and resolves the account from `auth.uid()` through the member's own active link. There is
 * no account id in the request, so "member B's card" is not a thing a member A can ask for — and
 * the negatives below assert exactly that rather than merely asserting a happy path.
 *
 * WHAT THIS IS NOT. It is not a Wallet test: nothing here signs a pass, and nothing here can. The
 * pass is still issued by `loyalty-wallet-pass` through the merchant button, the public card page
 * and now the member dashboard, all against the same issuer and the same object id. This function
 * answers one question — "which of MY accounts, if any, may a pass be issued for at this shop" —
 * and the merchant path is asserted to be untouched, because the whole point of the change was to
 * add a caller rather than to alter one.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

async function makeMember(phone: string, name = "Member"): Promise<{ userId: string; memberId: string }> {
  const userId = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    userId,
    `${userId.slice(0, 8)}@wallet.test`,
  ]);
  const r = await asUser(exec, userId, async () =>
    exec.query(`SELECT public.loyalty_member_register($1, $2) AS result`, [name, phone]),
  );
  return { userId, memberId: String(rpcJson(r.rows[0]).member_id ?? "") };
}

async function newCustomer(shopId: string = f.shopAId): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO public.customers (id, shop_id, name) VALUES ($1, $2, $3)`, [
    id,
    shopId,
    "Wallet Customer",
  ]);
  return id;
}

async function accountFor(shopId: string, customerId: string): Promise<string> {
  const r = await exec.query<{ id: string }>(
    `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND customer_id = $2`,
    [shopId, customerId],
  );
  const existing = r.rows[0]?.id;
  if (existing) return existing;

  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO public.loyalty_accounts (id, shop_id, customer_id) VALUES ($1, $2, $3)`, [
    id,
    shopId,
    customerId,
  ]);
  return id;
}

async function link(memberId: string, shopId: string, accountId: string): Promise<void> {
  await exec.query(
    `INSERT INTO public.loyalty_member_links (member_id, account_id, shop_id, link_source, status)
     VALUES ($1, $2, $3, 'merchant_confirmed', 'active')`,
    [memberId, accountId, shopId],
  );
}

/** The member's request, exactly as the Edge Function makes it: a shop, and nothing else. */
const resolveWalletAccount = async (
  userId: string,
  shopId: string | null,
): Promise<Record<string, unknown>> => {
  const r = await asUser(exec, userId, async () =>
    // Explicit cast so a null argument is a null uuid rather than an untypable parameter.
    exec.query(`SELECT public.loyalty_member_wallet_account($1::uuid) AS result`, [shopId]),
  );
  return rpcJson(r.rows[0]);
};

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId);
  await enableProgram(exec, f.shopBId);
}, T);

afterAll(async () => {
  await exec?.close();
});

// ===========================================================================
// 1 — the member's own card
// ===========================================================================

describe("1. a member can obtain their own card's authority", () => {
  it("resolves their own account at the shop they are linked to", async () => {
    const { userId, memberId } = await makeMember("+256701100001");
    const accountId = await accountFor(f.shopAId, await newCustomer());
    await link(memberId, f.shopAId, accountId);

    const r = await resolveWalletAccount(userId, f.shopAId);
    expect(r.ok).toBe(true);
    expect(r.account_id).toBe(accountId);
    expect(r.shop_id).toBe(f.shopAId);
    expect(r.status).toBe("active");
  });

  it("works for every shop the member is linked to, one card each", async () => {
    const { userId, memberId } = await makeMember("+256701100002");
    const accountA = await accountFor(f.shopAId, await newCustomer(f.shopAId));
    const accountB = await accountFor(f.shopBId, await newCustomer(f.shopBId));
    await link(memberId, f.shopAId, accountA);
    await link(memberId, f.shopBId, accountB);

    expect((await resolveWalletAccount(userId, f.shopAId)).account_id).toBe(accountA);
    expect((await resolveWalletAccount(userId, f.shopBId)).account_id).toBe(accountB);
  });

  it("a suspended account is refused with the merchant path's own code", async () => {
    const { userId, memberId } = await makeMember("+256701100003");
    const accountId = await accountFor(f.shopAId, await newCustomer());
    await link(memberId, f.shopAId, accountId);
    await exec.query(`UPDATE public.loyalty_accounts SET status = 'suspended' WHERE id = $1`, [accountId]);

    const r = await resolveWalletAccount(userId, f.shopAId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("account_inactive");
  });

  it("a revoked account is refused, through the merchant's real revocation path", async () => {
    const { userId, memberId } = await makeMember("+256701100004");
    const accountId = await accountFor(f.shopAId, await newCustomer());
    await link(memberId, f.shopAId, accountId);
    expect((await resolveWalletAccount(userId, f.shopAId)).ok).toBe(true);

    // The merchant's own lifecycle RPC, not a hand-written UPDATE: a real revocation carries
    // revoked_at + purge_after, and the refusal is asserted against that, not against a shape
    // this test invented.
    const rpc = await asUser(exec, f.ownerAId, async () =>
      exec.query(`SELECT public.loyalty_set_account_lifecycle($1, $2, $3) AS result`, [
        f.shopAId,
        accountId,
        "revoke",
      ]),
    );
    expect(rpcJson(rpc.rows[0]).ok).toBe(true);

    const r = await resolveWalletAccount(userId, f.shopAId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("account_revoked");
  });

  it("an expired membership is refused — a lapsed card has no pass worth adding", async () => {
    const { userId, memberId } = await makeMember("+256701100005");
    const accountId = await accountFor(f.shopAId, await newCustomer());
    await link(memberId, f.shopAId, accountId);
    await exec.query(
      `UPDATE public.loyalty_accounts SET membership_expires_at = now() - interval '1 day' WHERE id = $1`,
      [accountId],
    );

    const r = await resolveWalletAccount(userId, f.shopAId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("membership_expired");
  });

  it("a revoked link removes the card immediately, and no account is returned", async () => {
    const { userId, memberId } = await makeMember("+256701100006");
    const accountId = await accountFor(f.shopAId, await newCustomer());
    await link(memberId, f.shopAId, accountId);
    expect((await resolveWalletAccount(userId, f.shopAId)).ok).toBe(true);

    await exec.query(
      `UPDATE public.loyalty_member_links SET status = 'revoked', revoked_at = now()
       WHERE member_id = $1 AND account_id = $2`,
      [memberId, accountId],
    );

    const r = await resolveWalletAccount(userId, f.shopAId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_found");
    expect(JSON.stringify(r)).not.toContain(accountId);
  });

  it("a closed member is refused before any account is considered", async () => {
    const { userId, memberId } = await makeMember("+256701100007");
    await link(memberId, f.shopAId, await accountFor(f.shopAId, await newCustomer()));
    await exec.query(`UPDATE public.loyalty_members SET status = 'closed' WHERE id = $1`, [memberId]);

    const r = await resolveWalletAccount(userId, f.shopAId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_a_member");
  });

  it("a suspended member is refused too — 'active' is the only membership that issues", async () => {
    const { userId, memberId } = await makeMember("+256701100008");
    await link(memberId, f.shopAId, await accountFor(f.shopAId, await newCustomer()));
    await exec.query(`UPDATE public.loyalty_members SET status = 'suspended' WHERE id = $1`, [memberId]);

    const r = await resolveWalletAccount(userId, f.shopAId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_a_member");
  });
});

// ===========================================================================
// 2 — no cross-member access
// ===========================================================================

describe("SECURITY: 2. a member cannot obtain another member's card", () => {
  it("two members at one shop each resolve only their own account", async () => {
    const alice = await makeMember("+256701100009", "Alice");
    const bob = await makeMember("+256701100010", "Bob");
    const aliceAccount = await accountFor(f.shopAId, await newCustomer());
    const bobAccount = await accountFor(f.shopAId, await newCustomer());
    await link(alice.memberId, f.shopAId, aliceAccount);
    await link(bob.memberId, f.shopAId, bobAccount);

    const aliceView = await resolveWalletAccount(alice.userId, f.shopAId);
    const bobView = await resolveWalletAccount(bob.userId, f.shopAId);

    expect(aliceView.account_id).toBe(aliceAccount);
    expect(bobView.account_id).toBe(bobAccount);
    expect(aliceView.account_id).not.toBe(bobView.account_id);
    // Neither payload mentions the other's account at all.
    expect(JSON.stringify(aliceView)).not.toContain(bobAccount);
    expect(JSON.stringify(bobView)).not.toContain(aliceAccount);
  });

  it("there is no account parameter to pass — the function takes a shop and nothing else", async () => {
    const r = await exec.query<{ args: string }>(
      `SELECT pg_get_function_identity_arguments(oid) AS args
       FROM pg_proc WHERE proname = 'loyalty_member_wallet_account'`,
    );
    expect(r.rows[0]!.args).toBe("p_shop_id uuid");
    // Not merely "unused": the argument list is the guarantee. There is no member id, no account
    // id, no customer id and no token for a caller to supply.
    expect(r.rows[0]!.args).not.toMatch(/member_id|account_id|customer|token|user/i);
  });

  it("an account at the shop that is not the member's is never returned", async () => {
    const { userId, memberId } = await makeMember("+256701100011", "Mine");
    const someoneElse = await makeMember("+256701100012", "Theirs");
    const theirAccount = await accountFor(f.shopAId, await newCustomer());
    await link(someoneElse.memberId, f.shopAId, theirAccount);

    // The member IS linked at this shop — just to a different card.
    const myAccount = await accountFor(f.shopAId, await newCustomer());
    await link(memberId, f.shopAId, myAccount);

    const r = await resolveWalletAccount(userId, f.shopAId);
    expect(r.account_id).toBe(myAccount);
    expect(r.account_id).not.toBe(theirAccount);
  });
});

// ===========================================================================
// 3 — no cross-shop access
// ===========================================================================

describe("SECURITY: 3. a member cannot use another shop's account", () => {
  it("a shop the member is not linked to is not_found, even though accounts exist there", async () => {
    const { userId, memberId } = await makeMember("+256701100013");
    await link(memberId, f.shopAId, await accountFor(f.shopAId, await newCustomer(f.shopAId)));
    const otherShopAccount = await accountFor(f.shopBId, await newCustomer(f.shopBId));

    const r = await resolveWalletAccount(userId, f.shopBId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_found");
    expect(JSON.stringify(r)).not.toContain(otherShopAccount);
  });

  it("a shop that does not exist answers exactly like one the member is not linked to", async () => {
    const { userId, memberId } = await makeMember("+256701100014");
    await link(memberId, f.shopAId, await accountFor(f.shopAId, await newCustomer()));

    const unlinked = await resolveWalletAccount(userId, f.shopBId);
    const unknown = await resolveWalletAccount(userId, crypto.randomUUID());
    // Identical answers: this cannot be used to discover which shops exist.
    expect(unlinked.error).toBe("not_found");
    expect(unknown.error).toBe("not_found");
    expect(unknown.ok).toBe(false);
  });

  it("staff of another shop get nothing from the member path", async () => {
    // `f.outsiderId` owns shop B and holds no membership anywhere.
    const r = await resolveWalletAccount(f.outsiderId, f.shopBId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_a_member");
  });

  it("a null shop is refused rather than answered", async () => {
    const { userId, memberId } = await makeMember("+256701100015");
    await link(memberId, f.shopAId, await accountFor(f.shopAId, await newCustomer()));

    const r = await resolveWalletAccount(userId, null);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("shop_required");
  });
});

// ===========================================================================
// 4 — unauthenticated requests fail
// ===========================================================================

describe("SECURITY: 4. unauthenticated requests fail closed", () => {
  it("anon is refused by grant, before the function body runs", async () => {
    await expect(
      asAnon(exec, async () =>
        exec.query(`SELECT public.loyalty_member_wallet_account($1) AS result`, [f.shopAId]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a session with no user identity is refused by the function itself, not by luck", async () => {
    // The grant admits `authenticated`; the identity check is what stops a tokenless one. This is
    // the second gate, and it is asserted separately so it cannot be removed unnoticed.
    await exec.exec("BEGIN");
    await exec.exec("SET LOCAL ROLE authenticated");
    try {
      const r = await exec.query(`SELECT public.loyalty_member_wallet_account($1) AS result`, [
        f.shopAId,
      ]);
      const out = rpcJson(r.rows[0]);
      expect(out.ok).toBe(false);
      expect(out.error).toBe("not_authenticated");
    } finally {
      await exec.exec("ROLLBACK");
    }
  });
});

// ===========================================================================
// 5 & 6 — the merchant flow, unchanged
// ===========================================================================

describe("5 & 6. the merchant Wallet path is unchanged and still functional", () => {
  it("the staff read that loyalty-wallet-pass depends on still resolves the account", async () => {
    // This is the merchant path's authority, reproduced exactly: the caller's JWT, then the
    // `loyalty_accounts_select` policy (`user_can_access_shop`). If this ever stopped working the
    // merchant button would break, so it is asserted here rather than assumed.
    const customerId = await newCustomer();
    const accountId = await accountFor(f.shopAId, customerId);

    const asOwner = await asUser(exec, f.ownerAId, async () =>
      exec.query<{ id: string }>(
        `SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND id = $2`,
        [f.shopAId, accountId],
      ),
    );
    expect(asOwner.rows[0]?.id).toBe(accountId);
  });

  it("the merchant path still refuses an account at a shop the caller does not work at", async () => {
    const accountId = await accountFor(f.shopAId, await newCustomer());
    const asOutsider = await asUser(exec, f.outsiderId, async () =>
      exec.query(`SELECT id FROM public.loyalty_accounts WHERE shop_id = $1 AND id = $2`, [
        f.shopAId,
        accountId,
      ]),
    );
    expect(asOutsider.rows).toHaveLength(0);
  });

  it("shop staff do not gain the member path — it is not a second way in for them", async () => {
    // The owner works at shop A and is not a loyalty member, so the member chain answers
    // `not_a_member`. Staff authority stays exactly where it was: the staff chain, over RLS.
    const r = await resolveWalletAccount(f.ownerAId, f.shopAId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_a_member");
  });

  it("issuance state on the account is untouched by the authority call", async () => {
    const { userId, memberId } = await makeMember("+256701100016");
    const accountId = await accountFor(f.shopAId, await newCustomer());
    await link(memberId, f.shopAId, accountId);

    const before = await exec.query<{ object_id: string | null; issued_at: string | null; qr: string }>(
      `SELECT google_wallet_object_id AS object_id, google_wallet_issued_at AS issued_at, qr_token AS qr
       FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );

    expect((await resolveWalletAccount(userId, f.shopAId)).ok).toBe(true);

    const after = await exec.query<{ object_id: string | null; issued_at: string | null; qr: string }>(
      `SELECT google_wallet_object_id AS object_id, google_wallet_issued_at AS issued_at, qr_token AS qr
       FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    // Read-only: resolving the account must never mark a pass as issued, and must never rotate
    // the card's QR identity.
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(after.rows[0]!.qr).toBeTruthy();
  });

  it("is declared stable — it cannot write anything", async () => {
    const r = await exec.query<{ volatility: string }>(
      `SELECT provolatile AS volatility FROM pg_proc WHERE proname = 'loyalty_member_wallet_account'`,
    );
    // 's' = stable.
    expect(r.rows[0]!.volatility).toBe("s");
  });
});

// ===========================================================================
// Payload safety
// ===========================================================================

describe("SECURITY: the authority payload carries no credential", () => {
  it("returns no qr_token and no public_card_token", async () => {
    const { userId, memberId } = await makeMember("+256701100017");
    const accountId = await accountFor(f.shopAId, await newCustomer());
    await link(memberId, f.shopAId, accountId);
    await exec.query(
      `UPDATE public.loyalty_accounts SET public_card_token = repeat('a', 64) WHERE id = $1`,
      [accountId],
    );

    const r = await resolveWalletAccount(userId, f.shopAId);
    const payload = JSON.stringify(r);
    expect(payload).not.toContain("qr_token");
    expect(payload).not.toContain("public_card_token");

    // Not vacuous — the row really does hold both, and neither appears.
    const row = await exec.query<{ qr: string; pub: string }>(
      `SELECT qr_token AS qr, public_card_token AS pub FROM public.loyalty_accounts WHERE id = $1`,
      [accountId],
    );
    expect(row.rows[0]!.qr).toBeTruthy();
    expect(row.rows[0]!.pub).toBeTruthy();
    expect(payload).not.toContain(row.rows[0]!.qr);
    expect(payload).not.toContain(row.rows[0]!.pub);
  });

  it("does not return the customer id either — the pass material is loaded server-side", async () => {
    const { userId, memberId } = await makeMember("+256701100018");
    const customerId = await newCustomer();
    await link(memberId, f.shopAId, await accountFor(f.shopAId, customerId));

    const r = await resolveWalletAccount(userId, f.shopAId);
    expect(r).not.toHaveProperty("customer_id");
    expect(JSON.stringify(r)).not.toContain(customerId);
  });

  it("service_role is not granted — the function is only meaningful with a user identity", async () => {
    const r = await exec.query<{ granted: boolean }>(
      `SELECT has_function_privilege('service_role',
         'public.loyalty_member_wallet_account(uuid)', 'execute') AS granted`,
    );
    expect(r.rows[0]!.granted).toBe(false);
  });
});

// ===========================================================================
// Scope of the change
// ===========================================================================

describe("the migration adds authority, not a Wallet subsystem", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20260930310000_loyalty_member_wallet_issue.sql"),
    "utf8",
  );

  it("creates no table, no column, no policy and no second issuer", () => {
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/alter table/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/insert into/i);
  });

  it("defines exactly one function, and it is the resolver", () => {
    const created = [...sql.matchAll(/create or replace function\s+public\.([a-z_]+)/gi)].map(
      (m) => m[1],
    );
    expect(created).toEqual(["loyalty_member_wallet_account"]);
  });

  it("its body performs no write of any kind", () => {
    // The prose above the function talks about the pass; the BODY is what runs, so the body is
    // what is asserted. No insert, no update, no delete, no sequence — a resolver cannot change
    // issuance state even if its callers misbehave.
    const body = sql.split("as $fn$")[1]?.split("$fn$;")[0] ?? "";
    expect(body).toContain("select");
    expect(body).not.toMatch(/\b(insert|update|delete|upsert|truncate)\b/i);
    expect(body).not.toMatch(/google_wallet|public_card_token|qr_token\s*=/i);
  });
});
