import { describe, expect, it } from "vitest";
import { t } from "../i18n";
import { balanceAfterRedeem, pointsStillNeeded, redeemErrorMessage } from "./loyaltyRedeemConfirm";

const BATCH2_KEYS = [
  "loyaltyRedeemConfirmTitle",
  "loyaltyRedeemConfirmBalance",
  "loyaltyRedeemConfirmBalanceAfter",
  "loyaltyRewardNeedsPoints",
  "loyaltyAdjustInvalidPoints",
  "loyaltyAdjustNoteRequired",
] as const;

describe("pointsStillNeeded (P6 shortfall preview)", () => {
  it("reports how many points are missing", () => {
    expect(pointsStillNeeded(100, 40)).toBe(60);
    expect(pointsStillNeeded(50, 0)).toBe(50);
  });

  it("is zero when the member can afford the reward", () => {
    expect(pointsStillNeeded(100, 100)).toBe(0);
    expect(pointsStillNeeded(100, 250)).toBe(0);
  });
});

describe("balanceAfterRedeem (P3 dialog preview)", () => {
  it("subtracts the cost from the current balance", () => {
    expect(balanceAfterRedeem(100, 40)).toBe(60);
    expect(balanceAfterRedeem(40, 40)).toBe(0);
  });

  it("never previews a negative balance (server stays authoritative)", () => {
    expect(balanceAfterRedeem(30, 50)).toBe(0);
  });
});

describe("redeemErrorMessage (P3 failure visibility)", () => {
  it("translates insufficient_points with both numbers", () => {
    const msg = redeemErrorMessage("en", "insufficient_points", 40, 100);
    expect(msg).toContain("40");
    expect(msg).toContain("100");
    expect(msg).not.toContain("insufficient_points");
  });

  it("maps every known failure code to human text", () => {
    for (const code of [
      "redemption_limit_reached",
      "reward_expired",
      "membership_expired",
      "forbidden",
      "some_new_code",
    ]) {
      const msg = redeemErrorMessage("en", code);
      expect(msg).toBeTruthy();
      expect(msg).not.toBe(code);
      expect(msg).not.toContain("_");
    }
  });

  it("falls back to the generic failure message", () => {
    expect(redeemErrorMessage("en", "whatever")).toBe(t("en", "loyaltyRedeemFailed"));
  });

  it("resolves in Luganda and Swahili without leaking the raw code", () => {
    for (const lang of ["lg", "sw"] as const) {
      for (const code of ["reward_expired", "membership_expired", "insufficient_points"]) {
        const msg = redeemErrorMessage(lang, code, 10, 50);
        expect(msg, `${lang}.${code}`).toBeTruthy();
        expect(msg, `${lang}.${code}`).not.toBe(code);
      }
    }
  });
});

describe("Batch 2 i18n keys", () => {
  it("resolve for en, lg and sw", () => {
    for (const key of BATCH2_KEYS) {
      for (const lang of ["en", "lg", "sw"] as const) {
        const value = t(lang, key);
        expect(value, `${lang}.${key}`).toBeTruthy();
        expect(value, `${lang}.${key}`).not.toBe(key);
      }
    }
  });

  it("carry their placeholders where the UI substitutes values", () => {
    expect(t("en", "loyaltyRedeemConfirmBalance")).toContain("{balance}");
    expect(t("en", "loyaltyRedeemConfirmBalanceAfter")).toContain("{balance}");
    expect(t("en", "loyaltyRewardNeedsPoints")).toContain("{needed}");
    expect(t("en", "loyaltyRewardNeedsPoints")).toContain("{balance}");
  });
});
