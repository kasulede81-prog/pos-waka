import { describe, expect, it } from "vitest";
import { matchesOwnerDeletionConfirmText } from "./ownerDeletionBlastRadius";

describe("matchesOwnerDeletionConfirmText (Phase 39.1)", () => {
  it("accepts DELETE PERMANENTLY", () => {
    expect(matchesOwnerDeletionConfirmText("DELETE PERMANENTLY", {})).toBe(true);
  });

  it("accepts exact shop name case-insensitively", () => {
    expect(
      matchesOwnerDeletionConfirmText("bakery", { shopName: "Bakery", organizationName: "Denis&sons" }),
    ).toBe(true);
  });

  it("accepts exact organization name case-insensitively", () => {
    expect(
      matchesOwnerDeletionConfirmText("Denis&sons", { shopName: "Bakery", organizationName: "Denis&sons" }),
    ).toBe(true);
  });

  it("rejects unrelated text", () => {
    expect(
      matchesOwnerDeletionConfirmText("delete", { shopName: "Bakery", organizationName: "Denis&sons" }),
    ).toBe(false);
  });
});
