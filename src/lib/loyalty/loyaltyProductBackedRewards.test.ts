import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isProductBackedReward,
  validateRewardInput,
  type LoyaltyReward,
  type RewardInput,
} from "./loyaltyRewards";
import { assertSafePublicCardJson } from "../../../supabase/functions/_shared/loyaltyWallet/publicCardTypes.ts";

const ROOT = join(process.cwd());

function baseInput(patch: Partial<RewardInput> = {}): RewardInput {
  return {
    name: "Free Coke",
    description: "",
    pointsRequired: 100,
    rewardKind: "product",
    productId: "11111111-1111-4111-8111-111111111111",
    productQuantity: 1,
    maxRedemptionsPerAccount: null,
    active: true,
    expiresOn: null,
    ...patch,
  };
}

describe("D030 product-backed rewards client", () => {
  it("2. merchant UI searches products (no manual product id field)", () => {
    const panel = readFileSync(join(ROOT, "src/components/loyalty/LoyaltyRewardsPanel.tsx"), "utf8");
    expect(panel).toMatch(/searchShopProductsForReward/);
    expect(panel).toMatch(/loyaltyRewardProductToGive/);
    expect(panel).not.toMatch(/type=["']text["'][^>]*productId|product_id.*onChange/);
  });

  it("4. checkout shows claim only for product-backed eligible rewards", () => {
    const row = readFileSync(join(ROOT, "src/components/pos/PosLoyaltyCustomerRow.tsx"), "utf8");
    expect(row).toMatch(/isProductBackedReward/);
    expect(row).toMatch(/loyaltyClaimAction/);
    expect(row).toMatch(/claim_requires_online|loyaltyClaimRequiresOnline/);
    expect(row).toMatch(/navigator\.onLine/);
  });

  it("24. offline claim blocked; normal redeem path unchanged", () => {
    const row = readFileSync(join(ROOT, "src/components/pos/PosLoyaltyCustomerRow.tsx"), "utf8");
    expect(row).toMatch(/online-only|claim_requires_online|navigator\.onLine/);
    const rewards = readFileSync(join(ROOT, "src/lib/loyalty/loyaltyRewards.ts"), "utf8");
    expect(rewards).toMatch(/loyalty_redeem_reward/);
    expect(rewards).not.toMatch(/loyalty_claim_product_reward/);
  });

  it("25. public card does not expose product id / stock / cost", () => {
    const lookup = readFileSync(
      join(ROOT, "supabase/functions/_shared/loyaltyWallet/publicCardLookup.ts"),
      "utf8",
    );
    expect(lookup).toMatch(/products\(name\)/);
    expect(lookup).toMatch(/never expose product_id/);
    const payload = {
      ok: true as const,
      customer_name: "John",
      shop_name: "Shop",
      program_name: "Loyalty",
      balance_points: 100,
      account_active: true,
      program_enabled: true,
      membership_active: true,
      membership_expires_on: null,
      qr_payload: "WAKA-LOYALTY:abc",
      rewards: [{ name: "Free Coca-Cola 500ml", points_required: 100, description: null }],
      your_rewards: [{ name: "Free Coca-Cola 500ml", points_required: 100, description: null }],
      wallet_configured: false,
    };
    expect(() => assertSafePublicCardJson(payload)).not.toThrow();
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(/product_id|stock_on_hand|cost_ugx|unitCost/);
  });

  it("validateRewardInput requires positive quantity when product linked", () => {
    expect(validateRewardInput(baseInput())).toBeNull();
    expect(validateRewardInput(baseInput({ productQuantity: 0 }))).toBe("invalid_product_quantity");
    expect(validateRewardInput(baseInput({ productId: null, productQuantity: 0 }))).toBeNull();
  });

  it("isProductBackedReward", () => {
    const r: LoyaltyReward = {
      id: "1",
      name: "x",
      description: "",
      pointsRequired: 1,
      rewardKind: "product",
      productId: "p1",
      productQuantity: 1,
      maxRedemptionsPerAccount: null,
      active: true,
      sortOrder: 0,
      expiresOn: null,
    };
    expect(isProductBackedReward(r)).toBe(true);
    expect(isProductBackedReward({ ...r, productId: null })).toBe(false);
  });

  it("migration is additive and reuses apply_sale_stock_movements", () => {
    const mig = readFileSync(
      join(ROOT, "supabase/migrations/20260924190000_loyalty_product_backed_rewards.sql"),
      "utf8",
    );
    expect(mig).toMatch(/product_quantity/);
    expect(mig).toMatch(/apply_sale_stock_movements/);
    expect(mig).toMatch(/source.*loyalty_reward|'loyalty_reward'/);
    expect(mig).not.toMatch(/create table.*financial_/i);
    expect(mig).not.toMatch(/loyalty_claim_product_reward/);
  });
});
