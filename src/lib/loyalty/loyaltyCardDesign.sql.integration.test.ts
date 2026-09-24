import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createLoyaltySqlHarness,
  rpcJson,
  seedLoyaltyFixture,
  type LoyaltyFixture,
  type SqlExec,
} from "../../test/sqlIntegration/loyaltyPgHarness";

let exec: SqlExec;
let f: LoyaltyFixture;
let managerAId: string;
let waiterAId: string;

beforeAll(async () => {
  exec = await createLoyaltySqlHarness();
  f = await seedLoyaltyFixture(exec);
  managerAId = crypto.randomUUID();
  waiterAId = crypto.randomUUID();
  await exec.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${managerAId}', 'manager-a@test.local'),
      ('${waiterAId}', 'waiter-a@test.local');
    INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
      ('${f.shopAId}', '${managerAId}', 'manager'),
      ('${f.shopAId}', '${waiterAId}', 'cashier');
  `);
}, 120_000);

afterAll(async () => {
  await exec.close();
});

async function upsertAs(
  userId: string,
  shopId: string,
  params: Record<string, unknown> = {},
) {
  return asUser(exec, userId, async () => {
    const { rows } = await exec.query(
      `SELECT public.loyalty_upsert_card_design(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) AS result`,
      [
        shopId,
        params.program_display_name ?? "Shop A Rewards",
        params.logo_url ?? "https://cdn.example.com/a.png",
        params.primary_color ?? "#aabbcc",
        params.accent_color ?? "#ddeeff",
        params.background_color ?? "#112233",
        params.text_color ?? "#fafafa",
        params.welcome_message ?? "Hello",
        params.card_style ?? "classic",
        params.reward_layout ?? "list",
      ],
    );
    return rpcJson(rows[0]);
  });
}

describe("loyalty_card_designs authorization", () => {
  it("lets the owner save a design", async () => {
    const result = await upsertAs(f.ownerAId, f.shopAId);
    expect(result.ok).toBe(true);
    const design = result.design as Record<string, unknown>;
    expect(design.primary_color).toBe("#aabbcc");
    expect(design.program_display_name).toBe("Shop A Rewards");
  });

  it("lets a shop manager save (user_can_manage_shop)", async () => {
    const result = await upsertAs(managerAId, f.shopAId, {
      program_display_name: "Manager Design",
      primary_color: "#123456",
    });
    expect(result.ok).toBe(true);
    expect((result.design as Record<string, unknown>).primary_color).toBe("#123456");
  });

  it("denies cashier / waiter-style staff", async () => {
    const cashier = await upsertAs(f.cashierAId, f.shopAId);
    expect(cashier.ok).toBe(false);
    expect(cashier.error).toBe("forbidden");

    const waiter = await upsertAs(waiterAId, f.shopAId);
    expect(waiter.ok).toBe(false);
    expect(waiter.error).toBe("forbidden");
  });

  it("denies outsider and cross-shop writes", async () => {
    const outsider = await upsertAs(f.outsiderId, f.shopAId);
    expect(outsider.ok).toBe(false);
    expect(outsider.error).toBe("forbidden");

    // Shop B owner cannot write Shop A
    const cross = await upsertAs(f.outsiderId, f.shopAId, {
      program_display_name: "Hijack",
    });
    expect(cross.ok).toBe(false);
  });

  it("rejects invalid color, style, layout, oversized text, unsafe logo", async () => {
    expect(
      (await upsertAs(f.ownerAId, f.shopAId, { primary_color: "red" })).error,
    ).toBe("invalid_color");
    expect(
      (await upsertAs(f.ownerAId, f.shopAId, { card_style: "neon" })).error,
    ).toBe("invalid_card_style");
    expect(
      (await upsertAs(f.ownerAId, f.shopAId, { reward_layout: "grid" })).error,
    ).toBe("invalid_reward_layout");
    expect(
      (await upsertAs(f.ownerAId, f.shopAId, { program_display_name: "x".repeat(61) })).error,
    ).toBe("invalid_program_name");
    expect(
      (await upsertAs(f.ownerAId, f.shopAId, { welcome_message: "y".repeat(121) })).error,
    ).toBe("invalid_welcome_message");
    expect(
      (await upsertAs(f.ownerAId, f.shopAId, { logo_url: "https://x.test/a.svg" })).error,
    ).toBe("invalid_logo_url");
    expect(
      (await upsertAs(f.ownerAId, f.shopAId, { logo_url: "http://x.test/a.png" })).error,
    ).toBe("invalid_logo_url");
  });

  it("normalizes hex to lowercase on save", async () => {
    const result = await upsertAs(f.ownerAId, f.shopAId, {
      primary_color: "#AABBCC",
      program_display_name: "Normalized",
    });
    expect(result.ok).toBe(true);
    expect((result.design as Record<string, unknown>).primary_color).toBe("#aabbcc");
  });

  it("resets design for authorized user and denies cross-shop reset", async () => {
    await upsertAs(f.ownerAId, f.shopAId, { program_display_name: "To Reset" });

    const denied = await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_reset_card_design($1) AS result`,
        [f.shopAId],
      );
      return rpcJson(rows[0]);
    });
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe("forbidden");

    const ok = await asUser(exec, f.ownerAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_reset_card_design($1) AS result`,
        [f.shopAId],
      );
      return rpcJson(rows[0]);
    });
    expect(ok.ok).toBe(true);

    const { rows } = await exec.query(
      `SELECT count(*)::int AS n FROM public.loyalty_card_designs WHERE shop_id = $1`,
      [f.shopAId],
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it("denies unauthorized direct table mutation", async () => {
    await expect(
      asUser(exec, f.cashierAId, async () => {
        await exec.query(
          `INSERT INTO public.loyalty_card_designs (shop_id, primary_color)
           VALUES ($1, '#111111')`,
          [f.shopAId],
        );
      }),
    ).rejects.toThrow();
  });
});

describe("loyalty_card_designs shop isolation for public read path", () => {
  it("Shop A design is not returned for Shop B shop_id", async () => {
    await upsertAs(f.ownerAId, f.shopAId, {
      program_display_name: "Only Shop A",
      primary_color: "#101010",
    });
    await asUser(exec, f.outsiderId, async () => {
      const { rows } = await exec.query(
        `SELECT public.loyalty_upsert_card_design(
          $1, 'Only Shop B', null, '#202020', null, null, null, null, 'modern', 'cards'
        ) AS result`,
        [f.shopBId],
      );
      expect(rpcJson(rows[0]).ok).toBe(true);
    });

    const { rows: a } = await exec.query(
      `SELECT program_display_name, primary_color FROM public.loyalty_card_designs WHERE shop_id = $1`,
      [f.shopAId],
    );
    const { rows: b } = await exec.query(
      `SELECT program_display_name, primary_color FROM public.loyalty_card_designs WHERE shop_id = $1`,
      [f.shopBId],
    );
    expect(a[0].program_display_name).toBe("Only Shop A");
    expect(b[0].program_display_name).toBe("Only Shop B");
    expect(a[0].primary_color).not.toBe(b[0].primary_color);
  });
});
