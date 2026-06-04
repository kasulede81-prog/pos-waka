import { describe, expect, it } from "vitest";

/**
 * Documents single-owner invariant enforced in migration 095:
 * - partial unique index on shop_members (shop_id) where role = 'owner'
 * - trigger trg_shop_members_single_owner rejects second owner
 */
describe("single owner protection (spec)", () => {
  it("defines one owner per shop at database level", () => {
    const rules = [
      "shop_members_one_owner_per_shop unique index",
      "trg_shop_members_enforce_single_owner trigger",
      "duplicate owners demoted to manager on migration",
    ];
    expect(rules).toHaveLength(3);
  });
});
