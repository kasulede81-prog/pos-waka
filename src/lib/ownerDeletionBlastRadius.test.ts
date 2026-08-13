import { describe, expect, it } from "vitest";
import { matchesOwnerDeletionConfirmText } from "./ownerDeletionBlastRadius";

describe("matchesOwnerDeletionConfirmText (Phase 39.3)", () => {
  const org = { organizationName: "Denis&sons", shopName: "Bakery" };

  it("accepts DELETE PERMANENTLY", () => {
    expect(matchesOwnerDeletionConfirmText("DELETE PERMANENTLY", org)).toBe(true);
  });

  it("accepts DELETE PERMANENTLY with surrounding whitespace", () => {
    expect(matchesOwnerDeletionConfirmText("  DELETE PERMANENTLY  ", org)).toBe(true);
  });

  it("accepts exact organization name case-insensitively", () => {
    expect(matchesOwnerDeletionConfirmText("Denis&sons", org)).toBe(true);
    expect(matchesOwnerDeletionConfirmText("denis&sons", org)).toBe(true);
  });

  it("rejects shop name unless it is also the organization name", () => {
    expect(matchesOwnerDeletionConfirmText("bakery", org)).toBe(false);
    expect(matchesOwnerDeletionConfirmText("Bakery", org)).toBe(false);
  });

  it("rejects incorrect organization name", () => {
    expect(matchesOwnerDeletionConfirmText("Other Org", org)).toBe(false);
  });

  it("rejects wrong case of the required phrase", () => {
    expect(matchesOwnerDeletionConfirmText("delete permanently", org)).toBe(false);
  });

  it("rejects empty value", () => {
    expect(matchesOwnerDeletionConfirmText("", org)).toBe(false);
    expect(matchesOwnerDeletionConfirmText("   ", org)).toBe(false);
  });
});
