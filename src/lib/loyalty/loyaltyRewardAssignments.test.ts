import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Decision 029 reward assignments contracts", () => {
  it("migration adds assignments table without rewriting prior phases", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/migrations/20260924180000_loyalty_reward_assignments.sql"),
      "utf8",
    );
    expect(src).toMatch(/loyalty_reward_assignments/);
    expect(src).toMatch(/loyalty_assign_reward/);
    expect(src).toMatch(/loyalty_account_reward_granted/);
    expect(src).toMatch(/assignment_expired/);
    expect(src).toMatch(/requires_offer_grant/);
  });

  it("public card separates your_rewards from shop catalogue", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/functions/_shared/loyaltyWallet/publicCardLookup.ts"),
      "utf8",
    );
    expect(src).toMatch(/yourRewards|your_rewards/);
    expect(src).toMatch(/requires_offer_grant/);
    expect(src).toMatch(/loyalty_reward_assignments/);
  });
});
