import { describe, expect, it } from "vitest";
import {
  applyCheckoutAlphaKey,
  applyCheckoutNumericKey,
  applyCheckoutPhoneKey,
  CHECKOUT_ALPHA_ROWS,
  POS_CATALOG_KEYPAD_OVERLAY_CLASS,
  preferredKeypadModeForField,
} from "./posCheckoutKeypad";

describe("posCheckoutKeypad", () => {
  it("applies numeric keys", () => {
    expect(applyCheckoutNumericKey("12", "3")).toBe("123");
    expect(applyCheckoutNumericKey("123", "back")).toBe("12");
    expect(applyCheckoutNumericKey("123", "C")).toBe("");
  });

  it("applies alpha keys for customer names", () => {
    expect(applyCheckoutAlphaKey("JO", "h")).toBe("JOH");
    expect(applyCheckoutAlphaKey("John", "space")).toBe("John ");
    expect(applyCheckoutAlphaKey("John", "⌫")).toBe("Joh");
  });

  it("applies phone keys with digit-only input", () => {
    expect(applyCheckoutPhoneKey("077", "4")).toBe("0774");
    expect(applyCheckoutPhoneKey("0774", "back")).toBe("077");
  });

  it("prefers alpha mode for customer name field", () => {
    expect(preferredKeypadModeForField("customerName")).toBe("alpha");
    expect(preferredKeypadModeForField("cash")).toBe("numeric");
  });

  it("catalog keypad overlay is height-capped with dvh so Windows web cannot clip keys", () => {
    expect(POS_CATALOG_KEYPAD_OVERLAY_CLASS).toContain("h-[min(56dvh,28rem)]");
    expect(POS_CATALOG_KEYPAD_OVERLAY_CLASS).toContain("overflow-hidden");
    expect(POS_CATALOG_KEYPAD_OVERLAY_CLASS).not.toContain("h-[min(48dvh,24rem)]");
  });

  it("alpha rows include every letter once", () => {
    const letters = CHECKOUT_ALPHA_ROWS.flat().filter((k) => k !== "⌫");
    expect(letters).toHaveLength(26);
    expect(new Set(letters).size).toBe(26);
  });
});
