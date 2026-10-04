import { describe, expect, it, vi } from "vitest";
import { runNonceBoundGooglePopup, sha256Hex } from "./googleIdentity";

/**
 * The nonce contract for the staff invitation Google flow.
 *
 * Supabase Auth hashes the nonce it is handed (SHA-256, lowercase hex) and compares
 * that to the `nonce` claim inside the ID token. Google embeds verbatim whatever it
 * was initialised with. Therefore Google must receive the HASH and Supabase must
 * receive the RAW value — the opposite of what this code did, which is why every
 * invitation acceptance failed with `invalid nonce` / "Nonces mismatch".
 *
 * These tests exercise the real functions. They assert the transformation and the
 * direction of each value, not the presence of identifiers in source text —
 * a source-text assertion is exactly what let the broken version pass CI.
 */

/** Minimal GIS surface `runNonceBoundGooglePopup` drives, recording what it was initialised with. */
function fakeGoogleId() {
  const initializations: Record<string, unknown>[] = [];
  const disableAutoSelect = vi.fn();
  return {
    initializations,
    disableAutoSelect,
    googleId: {
      initialize: (config: Record<string, unknown>) => {
        initializations.push(config);
      },
      disableAutoSelect,
    },
  };
}

describe("sha256Hex", () => {
  it("matches the published SHA-256 vectors", async () => {
    // Fixed inputs with externally known digests: if the hash is wrong, these fail
    // regardless of how the rest of the flow is wired.
    await expect(sha256Hex("")).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    await expect(sha256Hex("hello")).resolves.toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("emits lowercase hex of exactly 64 characters", async () => {
    const digest = await sha256Hex("staff-invite");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("runNonceBoundGooglePopup — Google receives the hash, Supabase receives the raw value", () => {
  it("initialises GIS with sha256(rawNonce) and returns the raw nonce for Supabase", async () => {
    const { googleId, initializations } = fakeGoogleId();

    const result = await runNonceBoundGooglePopup({
      clientId: "test-client.apps.googleusercontent.com",
      googleId,
      openPopup: async () => "fake.id.token",
    });

    expect(initializations).toHaveLength(1);
    const gisNonce = initializations[0]!.nonce;
    expect(typeof gisNonce).toBe("string");

    // A + C — the value handed to Google IS the SHA-256 hex of the value handed back
    // to the caller (which is the one Supabase will receive).
    expect(gisNonce).toBe(await sha256Hex(result.nonce));

    // B — the returned nonce is the raw one, not the hash.
    expect(result.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(result.nonce).not.toBe(gisNonce);
  });

  it("does not double-hash the nonce", async () => {
    const { googleId, initializations } = fakeGoogleId();

    const result = await runNonceBoundGooglePopup({
      clientId: "test-client.apps.googleusercontent.com",
      googleId,
      openPopup: async () => "fake.id.token",
    });

    const gisNonce = initializations[0]!.nonce as string;
    const onceHashed = await sha256Hex(result.nonce);

    // Google got the single hash…
    expect(gisNonce).toBe(onceHashed);
    // …and neither the double hash nor the raw value.
    expect(gisNonce).not.toBe(await sha256Hex(onceHashed));
    expect(gisNonce).not.toBe(result.nonce);
  });

  it("carries the client id and the popup-mode configuration alongside the nonce", async () => {
    const { googleId, initializations } = fakeGoogleId();

    await runNonceBoundGooglePopup({
      clientId: "test-client.apps.googleusercontent.com",
      googleId,
      openPopup: async () => "fake.id.token",
    });

    const config = initializations[0]!;
    expect(config.client_id).toBe("test-client.apps.googleusercontent.com");
    expect(config.ux_mode).toBe("popup");
    expect(config.auto_select).toBe(false);
  });

  it("returns the ID token from the popup unchanged", async () => {
    const { googleId } = fakeGoogleId();

    const result = await runNonceBoundGooglePopup({
      clientId: "test-client.apps.googleusercontent.com",
      googleId,
      openPopup: async () => "the.credential.jwt",
    });

    expect(result.idToken).toBe("the.credential.jwt");
  });

  it("generates a distinct nonce pair for every attempt", async () => {
    const seen = new Set<string>();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { googleId, initializations } = fakeGoogleId();
      const result = await runNonceBoundGooglePopup({
        clientId: "test-client.apps.googleusercontent.com",
        googleId,
        openPopup: async () => "fake.id.token",
      });
      seen.add(result.nonce);
      seen.add(initializations[0]!.nonce as string);
    }

    // Ten values, all different: no reuse of either form across attempts. Replay
    // protection depends on this.
    expect(seen.size).toBe(10);
  });

  it("disables auto-select before opening the popup", async () => {
    const { disableAutoSelect } = fakeGoogleId();
    const order: string[] = [];

    disableAutoSelect.mockImplementation(() => {
      order.push("disableAutoSelect");
    });

    await runNonceBoundGooglePopup({
      clientId: "test-client.apps.googleusercontent.com",
      googleId: {
        initialize: () => {
          order.push("initialize");
        },
        disableAutoSelect,
      },
      openPopup: async () => {
        order.push("openPopup");
        return "fake.id.token";
      },
    });

    expect(order).toEqual(["initialize", "disableAutoSelect", "openPopup"]);
  });

  it("propagates a cancelled popup without returning a nonce", async () => {
    const { googleId } = fakeGoogleId();

    await expect(
      runNonceBoundGooglePopup({
        clientId: "test-client.apps.googleusercontent.com",
        googleId,
        openPopup: async () => {
          throw new Error("Google sign-in was cancelled.");
        },
      }),
    ).rejects.toThrow("Google sign-in was cancelled.");
  });
});
