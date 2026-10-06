import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createLoyaltySqlHarness,
  enableProgram,
  rpcJson,
  seedLoyaltyFixture,
  type LoyaltyFixture,
  type SqlExec,
} from "../../test/sqlIntegration/loyaltyPgHarness";

/**
 * CUSTOMER LOYALTY PHASE B — member dashboard projection v2 (projection-only).
 *
 * Pins exactly what Phase B added to `loyalty_member_dashboard()` and nothing more:
 *
 *  1. WALLET STATE — google_wallet_issued_at / google_wallet_sync_balance surface so the
 *     button can say "Add" vs "Open" vs "Update" honestly. google_wallet_object_id is NOT
 *     returned, and no field can claim the pass is "installed" (the API gives no such signal).
 *  2. CARD IDENTITY — the member's own qr_token plus the one-way member number / decorative
 *     CVC, asserted byte-for-byte against the TypeScript reference
 *     (deriveLoyaltyMemberNumber) so the dashboard card and the public card can never
 *     disagree about a member's number.
 *  3. THE SHAREABLE BEARER (public_card_token) remains withheld, and the derivation helper
 *     is not callable by the browser.
 *  4. projection_version = 2, and the auth.uid() scoping that makes cross-member reads
 *     structurally impossible is unchanged.
 */

const T = 120_000;

let exec: SqlExec;
let f: LoyaltyFixture;

/** The exact TypeScript reference from publicCardLookup.ts deriveLoyaltyMemberNumber. */
function referenceIdentity(accountId: string): { member_number: string; member_cvc: string } {
  const hex = createHash("sha256").update(accountId).digest("hex");
  const body = hex.slice(0, 16).toUpperCase();
  const member_number = (body.match(/.{1,4}/g) ?? []).join(" ");
  const member_cvc = String(parseInt(hex.slice(-8), 16) % 1000).padStart(3, "0");
  return { member_number, member_cvc };
}

async function makeMember(phone: string, name = "Member"): Promise<{ userId: string; memberId: string }> {
  const userId = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
    userId,
    `${userId.slice(0, 8)}@phaseb.test`,
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
    "Phase B Customer",
  ]);
  return id;
}

async function accountFor(shopId: string, customerId: string): Promise<string> {
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

type DashboardRow = {
  ok: boolean;
  meta: { projection_version: number };
  accounts: Array<{
    account: Record<string, unknown>;
    card: Record<string, unknown>;
  }>;
};

const dashboardFor = async (userId: string): Promise<DashboardRow> => {
  const r = await asUser(exec, userId, async () =>
    exec.query(`SELECT public.loyalty_member_dashboard() AS result`),
  );
  return rpcJson(r.rows[0]) as DashboardRow;
};

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  await enableProgram(exec, f.shopAId);
}, T);

afterAll(async () => {
  await exec?.close();
});

describe("1. projection v2 exposes wallet state and card identity", () => {
  it("returns the new fields, version 2, and still withholds every bearer credential", async () => {
    const { userId, memberId } = await makeMember("+256777000001", "Phase B");
    const customerId = await newCustomer();
    const accountId = await accountFor(f.shopAId, customerId);
    await link(memberId, f.shopAId, accountId);

    const dash = await dashboardFor(userId);
    expect(dash.ok).toBe(true);
    expect(dash.meta.projection_version).toBe(2);
    expect(dash.accounts).toHaveLength(1);

    const entry = dash.accounts[0];
    // Wallet state: keys present, values null until a pass exists.
    expect(entry.account).toHaveProperty("google_wallet_issued_at");
    expect(entry.account).toHaveProperty("google_wallet_sync_balance");
    expect(entry.account.google_wallet_issued_at).toBeNull();
    expect(entry.account.google_wallet_sync_balance).toBeNull();

    // Card identity present and correct.
    const { rows } = await exec.query(`SELECT qr_token FROM public.loyalty_accounts WHERE id = $1`, [
      accountId,
    ]);
    expect(entry.card.qr_token).toBe(rows[0].qr_token);
    const ref = referenceIdentity(accountId);
    expect(entry.card.member_number).toBe(ref.member_number);
    expect(entry.card.member_cvc).toBe(ref.member_cvc);
    expect(entry.card.member_number).toMatch(/^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/);
    expect(entry.card.member_cvc).toMatch(/^\d{3}$/);

    // The shareable bearer URL token must NEVER appear anywhere in the payload.
    const raw = JSON.stringify(dash);
    expect(raw).not.toContain("public_card_token");
    expect(raw).not.toContain("customer_id");
    // And no field pretends to know installation state.
    expect(raw.toLowerCase()).not.toContain("installed");
  });

  it("wallet fields follow the account row once a pass exists", async () => {
    const { userId, memberId } = await makeMember("+256777000002", "Walleted");
    const customerId = await newCustomer();
    const accountId = await accountFor(f.shopAId, customerId);
    await link(memberId, f.shopAId, accountId);

    await exec.query(
      `UPDATE public.loyalty_accounts
         SET google_wallet_issued_at = now(), google_wallet_sync_balance = 42
       WHERE id = $1`,
      [accountId],
    );

    const dash = await dashboardFor(userId);
    const account = dash.accounts[0].account;
    expect(account.google_wallet_issued_at).not.toBeNull();
    expect(account.google_wallet_sync_balance).toBe(42);
  });
});

describe("2. the card-identity helper matches the TypeScript reference", () => {
  it("derives identical member numbers and CVCs for several uuids", async () => {
    for (const raw of [
      "11111111-2222-3333-4444-555555555555",
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      crypto.randomUUID(),
    ]) {
      const { rows } = await exec.query(
        `SELECT public.loyalty_member_card_identity($1::uuid) AS result`,
        [raw],
      );
      const identity = rpcJson(rows[0]);
      const ref = referenceIdentity(raw);
      expect(identity.member_number).toBe(ref.member_number);
      expect(identity.member_cvc).toBe(ref.member_cvc);
    }
  });
});

describe("3. the helper is not a browser-callable authority", () => {
  it("authenticated callers cannot invoke the derivation function directly", async () => {
    const { userId } = await makeMember("+256777000003", "Denied");
    await expect(
      asUser(exec, userId, async () =>
        exec.query(`SELECT public.loyalty_member_card_identity($1::uuid)`, [crypto.randomUUID()]),
      ),
    ).rejects.toThrow();
  });

  it("another member's dashboard still cannot see this member's accounts", async () => {
    const a = await makeMember("+256777000004", "A");
    const customerId = await newCustomer();
    const accountId = await accountFor(f.shopAId, customerId);
    await link(a.memberId, f.shopAId, accountId);

    const b = await makeMember("+256777000005", "B");
    const dashB = await dashboardFor(b.userId);
    expect(dashB.ok).toBe(true);
    expect(dashB.accounts).toHaveLength(0);

    const dashA = await dashboardFor(a.userId);
    expect(dashA.accounts).toHaveLength(1);
  });
});
