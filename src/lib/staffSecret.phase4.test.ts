import { describe, expect, it } from "vitest";
import {
  hashStaffSecret,
  hashStaffSecretAsync,
  isLegacyStaffHash,
  isModernStaffHash,
  migrateStaffSecretsAfterLogin,
  needsStaffHashMigration,
  staffSecretMatches,
  staffSecretMatchesAsync,
} from "./staffSecret";

describe("staffSecret phase4", () => {
  it("legacy fnv1a hashes remain verifiable", () => {
    const hash = hashStaffSecret("1234");
    expect(isLegacyStaffHash(hash)).toBe(true);
    expect(staffSecretMatches({ pinHash: hash }, "1234")).toBe(true);
  });

  it("new hashes use argon2id or bcrypt", async () => {
    const hash = await hashStaffSecretAsync("5678");
    expect(isModernStaffHash(hash)).toBe(true);
    expect(hash.startsWith("argon2id:") || hash.startsWith("bcrypt:")).toBe(true);
    expect(await staffSecretMatchesAsync({ pinHash: hash }, "5678")).toBe(true);
    expect(await staffSecretMatchesAsync({ pinHash: hash }, "0000")).toBe(false);
  });

  it("pbkdf2 legacy hashes still verify", async () => {
    const legacy = await (async () => {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode("9999"),
        "PBKDF2",
        false,
        ["deriveBits"],
      );
      const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
        keyMaterial,
        256,
      );
      const b64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
      const saltB64 = btoa(String.fromCharCode(...salt));
      return `pbkdf2:100000:${saltB64}:${b64}`;
    })();
    expect(needsStaffHashMigration(legacy)).toBe(true);
    expect(await staffSecretMatchesAsync({ pinHash: legacy }, "9999")).toBe(true);
  });

  it("migrates legacy hash after successful login", async () => {
    const legacy = hashStaffSecret("4321");
    const migrated = await migrateStaffSecretsAfterLogin({ pinHash: legacy }, "4321");
    expect(migrated.migrated).toBe(true);
    expect(isModernStaffHash(migrated.pinHash)).toBe(true);
  });
});
