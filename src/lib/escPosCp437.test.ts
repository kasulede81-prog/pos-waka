import { describe, expect, it } from "vitest";
import { encodeEscPosCp437, encodeEscPosCp437Bytes, isEscPosCp437Mapped } from "./escPosCp437";

describe("encodeEscPosCp437", () => {
  it("leaves ASCII unchanged", () => {
    const ascii = "WAKA POS INV-000042 UGX 12,000";
    expect(encodeEscPosCp437Bytes(ascii)).toEqual([...ascii].map((c) => c.charCodeAt(0)));
    expect(encodeEscPosCp437(ascii).unsupported).toEqual([]);
  });

  it("encodes UGX as ASCII", () => {
    expect(encodeEscPosCp437Bytes("UGX")).toEqual([0x55, 0x47, 0x58]);
  });

  it("maps CP437 letters and pound", () => {
    const { bytes, unsupported } = encodeEscPosCp437("éöü£");
    expect(bytes).toEqual([0x82, 0x94, 0x81, 0x9c]);
    expect(unsupported).toEqual([]);
    expect(isEscPosCp437Mapped("é".codePointAt(0)!)).toBe(true);
    expect(isEscPosCp437Mapped("£".codePointAt(0)!)).toBe(true);
  });

  it("folds common dashes quotes and apostrophes to ASCII", () => {
    const { bytes, unsupported } = encodeEscPosCp437("— – ‘ ’ “ ”");
    expect(bytes).toEqual([0x2d, 0x20, 0x2d, 0x20, 0x27, 0x20, 0x27, 0x20, 0x22, 0x20, 0x22]);
    expect(unsupported).toEqual([]);
  });

  it("does not map euro to pound or another currency", () => {
    const { bytes, unsupported } = encodeEscPosCp437("€");
    expect(bytes).toEqual([0x3f]);
    expect(unsupported).toEqual(["€"]);
    expect(isEscPosCp437Mapped("€".codePointAt(0)!)).toBe(false);
  });

  it("replaces unsupported Unicode without inventing a lookalike", () => {
    const { bytes, unsupported } = encodeEscPosCp437("¥€");
    expect(bytes[0]).toBe(0x9d); // yen is in CP437
    expect(bytes[1]).toBe(0x3f);
    expect(unsupported).toEqual(["€"]);
  });
});
