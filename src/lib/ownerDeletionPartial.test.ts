import { describe, expect, it } from "vitest";
import { classifyOwnerDeletionFailure, ownerFacingDeletionMessage } from "./ownerDeletionErrors";

describe("partial deletion recovery contract (Phase 39.3)", () => {
  it("owner auth failure after database delete is PARTIAL", () => {
    expect(
      classifyOwnerDeletionFailure({ error: "auth_delete_failed", partial: true }),
    ).toBe("PARTIAL_DELETE");
  });

  it("staff auth remaining is PARTIAL", () => {
    expect(
      classifyOwnerDeletionFailure({
        error: "auth_delete_failed",
        detail: "staff-1: User not found",
        partial: true,
      }),
    ).toBe("PARTIAL_DELETE");
  });

  it("retry copy does not claim full success", () => {
    const msg = ownerFacingDeletionMessage("PARTIAL_DELETE");
    expect(msg.toLowerCase()).toContain("retry cleanup");
    expect(msg.toLowerCase()).not.toContain("successfully");
  });

  it("verification_failed without partial is not a local deleted lock", () => {
    expect(
      classifyOwnerDeletionFailure({ error: "verification_failed", partial: false }),
    ).toBe("DELETE_FAILED");
  });

  it("already-deleted auth users are treated as cleaned in the Edge helper", () => {
    const gone = (message: string) => {
      const m = message.toLowerCase();
      return m.includes("user not found") || m.includes("user does not exist") || m.includes("already deleted");
    };
    expect(gone("User not found")).toBe(true);
    expect(gone("User already deleted")).toBe(true);
    expect(gone("network")).toBe(false);
  });
});
