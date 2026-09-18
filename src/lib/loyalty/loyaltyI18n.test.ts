import { describe, expect, it } from "vitest";
import { swOverrides } from "../i18n/swOverrides";
import { t } from "../i18n";

const KEYS = [
  "loyaltyAttachCustomerHint",
  "loyaltyBalanceLabel",
  "loyaltyPointsUnit",
  "loyaltyEarnsSuffix",
  "loyaltyOfflineEstimate",
] as const;

describe("loyalty i18n keys (Phase 03 checkout badge)", () => {
  it("resolve for en, lg and sw", () => {
    for (const key of KEYS) {
      for (const lang of ["en", "lg", "sw"] as const) {
        const value = t(lang, key);
        expect(value, `${lang}.${key}`).toBeTruthy();
        expect(value, `${lang}.${key}`).not.toBe(key);
      }
    }
  });

  it("Swahili overrides carry all loyalty keys", () => {
    for (const key of KEYS) {
      expect(swOverrides[key], `swOverrides.${key}`).toBeTruthy();
    }
  });
});
