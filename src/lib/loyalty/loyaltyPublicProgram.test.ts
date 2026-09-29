import { describe, expect, it, vi } from "vitest";

/**
 * WPL public code — the pure client surface.
 *
 * The load-bearing property here is that a SCANNED QR and a TYPED code resolve to the same
 * program. That holds because both go through `buildProgramJoinUrl` / `parseProgramCodeFromUrl`,
 * and it is asserted as a round trip rather than as two independent expectations — two separate
 * assertions could both pass while the pair disagrees.
 */

// businessProfile pulls in the POS store, which has no place in a pure-helper test.
vi.mock("../../store/usePosStore", () => ({ usePosStore: { getState: () => ({}) } }));

const {
  PROGRAM_CODE_RE,
  buildProgramJoinPath,
  buildProgramJoinUrl,
  isValidProgramCodeFormat,
  normalizeProgramCode,
  parseProgramCodeFromUrl,
} = await import("./loyaltyPublicProgram");
const { routeScannedCode } = await import("./loyaltyScanRouting");
const { encodeLoyaltyQrPayload } = await import("./loyaltyEnrollment");

const CODE = "WPL2026001";

describe("code format", () => {
  it("accepts the documented shapes, including the 1000+ extension", () => {
    expect(isValidProgramCodeFormat("WPL2026001")).toBe(true);
    expect(isValidProgramCodeFormat("WPL20261000")).toBe(true);
    expect(isValidProgramCodeFormat("WPL202610001")).toBe(true);
    expect(PROGRAM_CODE_RE.test("WPL2026001")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "WPL", "WPL26", "WPL202600", "2026001", "WPL2026ABC", "WPL2026001X"]) {
      expect(isValidProgramCodeFormat(bad), bad).toBe(false);
    }
  });

  it("normalises case and stray whitespace so typing is forgiving", () => {
    expect(normalizeProgramCode("  wpl2026001 ")).toBe(CODE);
    expect(isValidProgramCodeFormat("wpl2026001")).toBe(true);
  });
});

describe("QR and manual entry resolve to the SAME program", () => {
  it("round-trips the QR payload back to the code", () => {
    const url = buildProgramJoinUrl(CODE);
    expect(url).toBe("https://loyalty.waka.ug/j/WPL2026001");
    // The property that matters: whatever the QR encodes, scanning yields the same code.
    expect(parseProgramCodeFromUrl(url)).toBe(CODE);
  });

  it("round-trips on a custom origin too", () => {
    const url = buildProgramJoinUrl("wpl2026002", "http://localhost:5173");
    expect(url).toBe("http://localhost:5173/j/WPL2026002");
    expect(parseProgramCodeFromUrl(url)).toBe("WPL2026002");
  });

  it("accepts a bare code, so a QR of just the code also works", () => {
    expect(parseProgramCodeFromUrl(CODE)).toBe(CODE);
    expect(parseProgramCodeFromUrl(" wpl2026001 ")).toBe(CODE);
  });

  it("matches on the PATH, not the host, so a QR survives an origin change", () => {
    // Deliberate: the same QR must keep working if the program page moves between
    // pos.waka.ug, loyalty.waka.ug and a future custom domain. Matching the host would silently
    // break every printed poster. It cannot mis-fire, because `/j/` plus a WPL code is specific.
    expect(parseProgramCodeFromUrl("https://example.com/j/WPL2026001")).toBe(CODE);
    expect(parseProgramCodeFromUrl("http://localhost:5173/j/wpl2026001")).toBe(CODE);
  });

  it("returns null for payloads that are not a program code", () => {
    for (const bad of [
      "",
      "https://loyalty.waka.ug/c/" + "a".repeat(64),
      "https://loyalty.waka.ug/join/" + "b".repeat(64),
      "5901234123457",
      "https://example.com/j/WPL2026",
      "https://example.com/j/not-a-code",
    ]) {
      expect(parseProgramCodeFromUrl(bad), bad).toBeNull();
    }
  });

  it("the in-app path form matches the QR path", () => {
    expect(buildProgramJoinPath(CODE)).toBe("/j/WPL2026001");
    expect(buildProgramJoinUrl(CODE).endsWith(buildProgramJoinPath(CODE))).toBe(true);
  });
});

describe("scan routing precedence", () => {
  it("routes a program QR to the program, not to a product", () => {
    expect(routeScannedCode(buildProgramJoinUrl(CODE))).toEqual({
      kind: "program",
      programCode: CODE,
    });
  });

  it("still routes a member card QR to loyalty — the member token wins", () => {
    const token = "f".repeat(64);
    expect(routeScannedCode(encodeLoyaltyQrPayload(token))).toEqual({ kind: "loyalty", token });
  });

  it("still routes a plain barcode to the product path", () => {
    expect(routeScannedCode("5901234123457")).toEqual({
      kind: "product",
      code: "5901234123457",
    });
  });

  it("does not mistake a member card token for a program code", () => {
    const cardUrl = `https://loyalty.waka.ug/c/${"a".repeat(64)}`;
    expect(routeScannedCode(cardUrl).kind).toBe("product");
  });
});
