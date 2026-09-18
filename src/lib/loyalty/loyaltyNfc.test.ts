import { describe, expect, it } from "vitest";
import {
  detectNfcCapabilities,
  extractLoyaltyTokenFromNdefRecords,
  type NdefLikeRecord,
  type NdefReaderLike,
} from "../../services/hardware/nfcAdapter";

/**
 * Phase 07 — NFC identification internals: capability detection, NDEF
 * payload extraction, and the security rule that only `WAKA-LOYALTY:`
 * payloads resolve (raw NFC bytes are never trusted for anything else).
 */

describe("detectNfcCapabilities", () => {
  it("reports available on secure contexts with NDEFReader", () => {
    const ctor = class {} as unknown as new () => NdefReaderLike;
    expect(detectNfcCapabilities(ctor, { secureContext: true })).toEqual({
      nfc: true,
      reason: "available",
    });
  });

  it("reports unsupported when NDEFReader is missing", () => {
    expect(detectNfcCapabilities(null, { secureContext: true })).toEqual({
      nfc: false,
      reason: "unsupported",
    });
  });

  it("reports insecure_context on non-secure origins", () => {
    const ctor = class {} as unknown as new () => NdefReaderLike;
    expect(detectNfcCapabilities(ctor, { secureContext: false })).toEqual({
      nfc: false,
      reason: "insecure_context",
    });
  });

  it("reports unknown outside a browser environment", () => {
    expect(detectNfcCapabilities(null, null)).toEqual({ nfc: false, reason: "unknown" });
  });
});

describe("extractLoyaltyTokenFromNdefRecords", () => {
  const textRecord = (text: string): NdefLikeRecord => ({
    recordType: "text",
    data: new TextEncoder().encode(text).buffer as ArrayBuffer,
  });

  const urlRecord = (url: string): NdefLikeRecord => ({
    recordType: "url",
    data: new TextEncoder().encode(url).buffer as ArrayBuffer,
  });

  it("extracts the token from a text record carrying the loyalty payload", () => {
    expect(extractLoyaltyTokenFromNdefRecords([textRecord("WAKA-LOYALTY:tok-nfc-1")])).toBe(
      "tok-nfc-1",
    );
  });

  it("extracts the token from a URL record", () => {
    expect(extractLoyaltyTokenFromNdefRecords([urlRecord("WAKA-LOYALTY:tok-url")])).toBe("tok-url");
  });

  it("accepts Uint8Array and DataView data shapes", () => {
    const bytes = new TextEncoder().encode("WAKA-LOYALTY:tok-typed");
    expect(
      extractLoyaltyTokenFromNdefRecords([{ recordType: "text", data: bytes }]),
    ).toBe("tok-typed");
    expect(
      extractLoyaltyTokenFromNdefRecords([
        { recordType: "text", data: new DataView(bytes.buffer) },
      ]),
    ).toBe("tok-typed");
  });

  it("ignores product stickers, foreign payloads, and empty records", () => {
    expect(extractLoyaltyTokenFromNdefRecords([textRecord("7601234567890")])).toBeNull();
    expect(extractLoyaltyTokenFromNdefRecords([urlRecord("https://example.com/x")])).toBeNull();
    expect(extractLoyaltyTokenFromNdefRecords([{ recordType: "text", data: null }])).toBeNull();
    expect(extractLoyaltyTokenFromNdefRecords([{ recordType: "mime", mediaType: "text/plain", data: new Uint8Array([65]) }])).toBeNull();
  });

  it("scans multiple records and returns the first membership token", () => {
    expect(
      extractLoyaltyTokenFromNdefRecords([
        textRecord("external intro text"),
        urlRecord("WAKA-LOYALTY:second-rec"),
      ]),
    ).toBe("second-rec");
  });

  it("never returns a raw token for non-prefixed payloads (forgery guard)", () => {
    // Even a string that IS the bare token must not resolve: NFC payloads
    // must carry the WAKA-LOYALTY prefix to be considered.
    expect(extractLoyaltyTokenFromNdefRecords([textRecord("secret-token-value")])).toBeNull();
  });
});
