import { describe, expect, it } from "vitest";
import {
  buildGoogleLoyaltyClass,
  buildGoogleLoyaltyObject,
  buildGoogleSaveJwtClaims,
  buildGoogleWalletSaveUrl,
  createRs256SignerFromPkcs8Pem,
  GOOGLE_WALLET_SAVE_URL_BASE,
  googleClassId,
  googleObjectId,
} from "../../../../supabase/functions/_shared/loyaltyWallet/googleWalletPass.ts";
import type { LoyaltyPassInput } from "../../../../supabase/functions/_shared/loyaltyWallet/walletPassTypes.ts";

/**
 * Phase 06 — Google Wallet pass internals. The RS256 JWT signer is exercised
 * end-to-end with a WebCrypto-generated RSA key (real signing, real verification)
 * — matching Google Cloud service account key type.
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
  backgroundColor: "#FACC15",
  logoUrl: "https://example.test/logo.png",
};

const IDS = { issuerId: "3388000000000000001", classId: "waka_loyalty", objectId: "acct-1" };

describe("Google pass payloads", () => {
  it("builds class and object ids in issuer-scoped format", () => {
    expect(googleClassId(IDS)).toBe("3388000000000000001.waka_loyalty");
    expect(googleObjectId(IDS)).toBe("3388000000000000001.acct-1");
  });

  it("builds a LoyaltyClass with normalized hex color and logo", () => {
    const cls = buildGoogleLoyaltyClass(INPUT, IDS);
    expect(cls.id).toBe("3388000000000000001.waka_loyalty");
    expect(cls.issuerName).toBe("Kampala Kiosk");
    expect(cls.hexBackgroundColor).toBe("#facc15");
    expect((cls.programLogo as { sourceUri: { uri: string } }).sourceUri.uri).toBe(
      "https://example.test/logo.png",
    );
  });

  it("builds a LoyaltyObject with balance, member, and QR barcode", () => {
    const obj = buildGoogleLoyaltyObject(INPUT, IDS);
    expect(obj.classId).toBe("3388000000000000001.waka_loyalty");
    const points = obj.loyaltyPoints as { balance: { int: number } };
    expect(points.balance.int).toBe(42);
    const barcode = obj.barcode as { type: string; value: string };
    expect(barcode.type).toBe("QR_CODE");
    expect(barcode.value).toBe("WAKA-LOYALTY:tok123opaque");
    expect(JSON.stringify(obj)).not.toContain("+256");
  });
});

describe("save JWT claims", () => {
  it("sets google audience, savetowallet type, and one-hour expiry", () => {
    const claims = buildGoogleSaveJwtClaims(
      { serviceAccountEmail: "wallet@waka.iam.gserviceaccount.com" },
      { id: "class" },
      { id: "object" },
      ["https://waka.example"],
      1_700_000_000,
    );
    expect(claims.iss).toBe("wallet@waka.iam.gserviceaccount.com");
    expect(claims.aud).toBe("google");
    expect(claims.typ).toBe("savetowallet");
    expect(claims.iat).toBe(1_700_000_000);
    expect(claims.exp).toBe(1_700_000_000 + 3600);
    expect(claims.origins).toEqual(["https://waka.example"]);
    expect(claims.payload.loyaltyClasses).toHaveLength(1);
    expect(claims.payload.loyaltyObjects).toHaveLength(1);
  });

  it("builds the save URL with the signed JWT appended", async () => {
    const saveUrl = await buildGoogleWalletSaveUrl(
      {
        serviceAccountEmail: "wallet@waka.iam.gserviceaccount.com",
        async signJwt() {
          return "header.payload.signature";
        },
      },
      buildGoogleSaveJwtClaims(
        { serviceAccountEmail: "wallet@waka.iam.gserviceaccount.com" },
        { id: "class" },
        { id: "object" },
        [],
        1_700_000_000,
      ),
    );
    expect(saveUrl).toBe(`${GOOGLE_WALLET_SAVE_URL_BASE}header.payload.signature`);
  });
});

describe("createRs256SignerFromPkcs8Pem", () => {
  function pemEncode(label: string, der: Uint8Array): string {
    let binary = "";
    for (const b of der) binary += String.fromCharCode(b);
    const base64 = btoa(binary);
    const lines = base64.match(/.{1,64}/g) ?? [];
    return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
  }

  it("signs a JWT that verifies against the matching public key", async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);

    const signer = createRs256SignerFromPkcs8Pem(
      "wallet@waka.iam.gserviceaccount.com",
      pemEncode("PRIVATE KEY", new Uint8Array(pkcs8)),
    );

    const claims = buildGoogleSaveJwtClaims(
      signer,
      buildGoogleLoyaltyClass(INPUT, IDS),
      buildGoogleLoyaltyObject(INPUT, IDS),
      ["https://waka.example"],
      1_700_000_000,
    );
    const jwt = await signer.signJwt(claims as unknown as Record<string, unknown>);
    const [headerSegment, payloadSegment, signatureSegment] = jwt.split(".");
    expect(headerSegment).toBeTruthy();
    expect(payloadSegment).toBeTruthy();
    expect(signatureSegment).toBeTruthy();

    const headerJson = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(headerSegment.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    ) as { alg: string };
    expect(headerJson.alg).toBe("RS256");

    // Decode payload and confirm our claims survived the round trip.
    const payloadJson = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(payloadSegment.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    ) as Record<string, unknown>;
    expect(payloadJson.aud).toBe("google");
    expect(payloadJson.typ).toBe("savetowallet");

    // Verify RS256 signature over the signing input with the public key.
    const publicKey = await crypto.subtle.importKey(
      "spki",
      new Uint8Array(spki) as BufferSource,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signature = Uint8Array.from(
      atob(signatureSegment.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    const valid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      publicKey,
      signature as BufferSource,
      new TextEncoder().encode(`${headerSegment}.${payloadSegment}`) as BufferSource,
    );
    expect(valid).toBe(true);
  });
});
