import { describe, expect, it } from "vitest";
import {
  hashStaffSecret,
  hashStaffSecretAsync,
  isLegacyStaffHash,
  isModernStaffHash,
  staffSecretMatches,
  staffSecretMatchesAsync,
} from "./staffSecret";

describe("staffSecret", () => {
  it("legacy fnv1a hashes remain verifiable", () => {
    const hash = hashStaffSecret("1234");
    expect(isLegacyStaffHash(hash)).toBe(true);
    expect(staffSecretMatches({ pinHash: hash }, "1234")).toBe(true);
  });

  it("modern hashes verify async", async () => {
    const hash = await hashStaffSecretAsync("5678");
    expect(isModernStaffHash(hash)).toBe(true);
    expect(staffSecretMatches({ pinHash: hash }, "5678")).toBe(false);
    expect(await staffSecretMatchesAsync({ pinHash: hash }, "5678")).toBe(true);
    expect(await staffSecretMatchesAsync({ pinHash: hash }, "0000")).toBe(false);
  });
});
