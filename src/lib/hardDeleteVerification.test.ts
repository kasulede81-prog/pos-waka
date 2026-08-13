import { describe, expect, it } from "vitest";
import {
  authVerificationPassed,
  databaseVerificationPassed,
  mergeAuthVerification,
} from "./hardDeleteVerification";

describe("hard-delete verification order (Phase 39.3)", () => {
  it("database verification does not require auth.users = 0", () => {
    expect(
      databaseVerificationPassed({
        organizations: 0,
        shops: 0,
        sales: 0,
        owner_auth_account: 1,
        staff_auth_accounts: 2,
      }),
    ).toBe(true);
  });

  it("database verification fails when organization rows remain", () => {
    expect(
      databaseVerificationPassed({
        organizations: 1,
        shops: 0,
        owner_auth_account: 0,
        staff_auth_accounts: 0,
      }),
    ).toBe(false);
  });

  it("auth verification occurs after auth remaining counts are merged", () => {
    const merged = mergeAuthVerification(
      { organizations: 0, shops: 0, sales: 0, owner_auth_account: 1, staff_auth_accounts: 1 },
      0,
      0,
    );
    expect(authVerificationPassed(merged.counts)).toBe(true);
    expect(merged.all_passed).toBe(true);
  });

  it("final success requires both database and auth to be zero", () => {
    const merged = mergeAuthVerification({ organizations: 0, shops: 0 }, 1, 0);
    expect(databaseVerificationPassed(merged.counts)).toBe(true);
    expect(authVerificationPassed(merged.counts)).toBe(false);
    expect(merged.all_passed).toBe(false);
  });
});
