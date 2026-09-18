import { describe, expect, it } from "vitest";
import {
  buildApplePassJson,
  buildManifest,
  buildStoreOnlyZip,
  crc32,
  packPkpass,
} from "../../../../supabase/functions/_shared/loyaltyWallet/appleWalletPass.ts";
import type { ApplePassSigner, LoyaltyPassInput } from "../../../../supabase/functions/_shared/loyaltyWallet/walletPassTypes.ts";

/**
 * Phase 06 — Apple Wallet pass bundle internals. Everything except the
 * PKCS#7 signature is fully exercised here; signing is injected (Apple
 * Developer Program certificate — external blocker, see WALLET-INTEGRATION.md).
 */

const INPUT: LoyaltyPassInput = {
  shopId: "shop-1",
  shopName: "Kampala Kiosk",
  accountId: "acct-1",
  customerName: "Mama Brian",
  qrToken: "tok123opaque",
  qrPayload: "WAKA-LOYALTY:tok123opaque",
  balancePoints: 42,
  programLabel: "1 pt per UGX 1,000 spent",
  backgroundColor: "#facc15",
};

describe("crc32", () => {
  it("matches the standard check value", () => {
    const data = new TextEncoder().encode("123456789");
    expect(crc32(data)).toBe(0xcbf43926);
  });

  it("is deterministic and order-sensitive", () => {
    const a = new TextEncoder().encode("waka");
    const b = new TextEncoder().encode("akaw");
    expect(crc32(a)).toBe(crc32(a));
    expect(crc32(a)).not.toBe(crc32(b));
  });
});

describe("buildStoreOnlyZip", () => {
  it("produces a structurally valid ZIP (local header + EOCD)", () => {
    const zip = buildStoreOnlyZip([
      { name: "pass.json", data: new TextEncoder().encode("{}") },
      { name: "signature", data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(zip[0]).toBe(0x50); // 'P'
    expect(zip[1]).toBe(0x4b); // 'K'
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
    // EOCD record at the tail.
    const tail = zip.slice(zip.length - 22);
    expect(tail[0]).toBe(0x50);
    expect(tail[1]).toBe(0x4b);
    expect(tail[2]).toBe(0x05);
    expect(tail[3]).toBe(0x06);
    expect(tail[8]).toBe(2); // entries on this disk
    expect(tail[10]).toBe(2); // total entries
  });
});

describe("buildApplePassJson", () => {
  it("builds a storeCard with QR barcode and points header", () => {
    const pass = buildApplePassJson(INPUT, {
      passTypeIdentifier: "pass.com.waka.pos",
      teamIdentifier: "TEAM123456",
      serialNumber: "acct-1",
    });
    expect(pass.passTypeIdentifier).toBe("pass.com.waka.pos");
    expect(pass.teamIdentifier).toBe("TEAM123456");
    expect(pass.serialNumber).toBe("acct-1");
    expect(pass.organizationName).toBe("Kampala Kiosk");
    const card = pass.storeCard as { headerFields: { key: string; value: number }[] };
    expect(card.headerFields[0].key).toBe("points");
    expect(card.headerFields[0].value).toBe(42);
    const barcode = pass.barcode as { format: string; message: string };
    expect(barcode.format).toBe("PKBarcodeFormatQR");
    expect(barcode.message).toBe("WAKA-LOYALTY:tok123opaque");
    // No personal contact data on the pass.
    expect(JSON.stringify(pass)).not.toContain("+256");
  });

  it("normalizes hex colors to Apple rgb() strings", () => {
    const pass = buildApplePassJson(INPUT, {
      passTypeIdentifier: "pass.com.waka.pos",
      teamIdentifier: "TEAM123456",
      serialNumber: "acct-1",
    });
    expect(pass.backgroundColor).toBe("rgb(250, 204, 21)");
  });
});

describe("buildManifest", () => {
  it("hashes files with SHA-1", async () => {
    const manifest = await buildManifest({
      "pass.json": new TextEncoder().encode("{}"),
    });
    // SHA-1 of "{}" — well-known vector.
    expect(manifest["pass.json"]).toBe("bf21a9e8fbc5a3846fb05b4fa0859e0917b2202f");
  });
});

describe("packPkpass", () => {
  it("signs the exact manifest bytes and bundles all entries", async () => {
    let signedBytes: Uint8Array | null = null;
    const signer: ApplePassSigner = {
      async signManifest(manifestJsonBytes) {
        signedBytes = new Uint8Array(manifestJsonBytes);
        return new Uint8Array([0x30, 0x82, 0x01, 0x00]); // stub PKCS#7
      },
    };
    const passJson = buildApplePassJson(INPUT, {
      passTypeIdentifier: "pass.com.waka.pos",
      teamIdentifier: "TEAM123456",
      serialNumber: "acct-1",
    });
    const { pkpass, files } = await packPkpass({ passJson }, signer);

    expect(files).toEqual(["pass.json", "manifest.json", "signature"]);
    expect(signedBytes).not.toBeNull();
    // The signer saw a manifest that hashes pass.json.
    const manifestText = new TextDecoder().decode(signedBytes!);
    const manifest = JSON.parse(manifestText) as Record<string, string>;
    expect(Object.keys(manifest)).toEqual(["pass.json"]);
    expect(manifest["pass.json"]).toMatch(/^[0-9a-f]{40}$/);

    // The archive contains all three entries (scan for names in the zip).
    const text = new TextDecoder("latin1").decode(pkpass);
    expect(text).toContain("pass.json");
    expect(text).toContain("manifest.json");
    expect(text).toContain("signature");
  });

  it("rejects an empty signature", async () => {
    const signer: ApplePassSigner = {
      async signManifest() {
        return new Uint8Array(0);
      },
    };
    const passJson = buildApplePassJson(INPUT, {
      passTypeIdentifier: "pass.com.waka.pos",
      teamIdentifier: "TEAM123456",
      serialNumber: "acct-1",
    });
    await expect(packPkpass({ passJson }, signer)).rejects.toThrow("empty_pass_signature");
  });
});
