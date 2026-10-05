import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "../i18n";

/**
 * Phase 2 Batch 4 — Loyalty translation coverage.
 *
 * Follows the repository's source-scan pattern: the Phase 2 key set is derived
 * from the actual Loyalty sources, so a new `t(lang, "…")` call is covered the
 * moment it is written. Contract per the audit:
 *   1. every key exists (no raw-key leak),
 *   2. resolves in en / lg / sw,
 *   3. placeholders survive translation,
 *   4. nothing resolves empty,
 *   5. Phase 2 strings are genuinely translated (lg/sw are not English),
 *   6. error codes map to human text in every language.
 *
 * Four keys are deliberately language-invariant (brand/product identifiers):
 * Google Wallet naming and the example program code.
 */

const PHASE2_SOURCES = [
  "src/pages/LoyaltyHubPage.tsx",
  "src/lib/loyalty/loyaltyNav.ts",
  "src/lib/loyalty/loyaltyRedeemConfirm.ts",
  "src/lib/loyalty/loyaltyErrorMessages.ts",
  "src/components/shared/HorizontalTabBar.tsx",
  "src/components/layout/ConfirmationDialog.tsx",
];

const BRAND_OR_CODE_KEYS = new Set([
  "loyaltyGoogleWalletTitle",
  "loyaltyGoogleWalletSms",
  "loyaltyGoogleWalletWhatsApp",
  "loyaltyProgramPlaceholder", // example code "WPL2026001"
]);

/** Keys the Phase 2 batches introduced or explicitly required to be translated. */
const REQUIRED_PHASE2_KEYS = [
  // Batch 1 — states
  "loyaltyLoading",
  "loyaltyUnavailable",
  "loyaltyRetry",
  "loyaltyNoMembers",
  "loyaltyNoMembersFound",
  "loyaltyNoRewards",
  // Batch 2 — redemption confirmation
  "loyaltyRedeemConfirmTitle",
  "loyaltyRedeemConfirmBalance",
  "loyaltyRedeemConfirmBalanceAfter",
  "loyaltyRedeemAction",
  "loyaltyRedeemDone",
  "loyaltyRedeemAlready",
  "loyaltyRedeemFailed",
  "loyaltyInsufficientPoints",
  "loyaltyRedeemLimitReached",
  "loyaltyRewardExpiredRedeem",
  "loyaltyMembershipExpiredRedeem",
  "loyaltyRewardNeedsPoints",
  "confirm",
  "cancel",
  // Batch 2 — renew / adjust
  "loyaltyMembershipRenew",
  "loyaltyMembershipRenewed",
  "loyaltyMembershipExpired",
  "loyaltyAdjustApply",
  "loyaltyAdjustInvalidPoints",
  "loyaltyAdjustNoteRequired",
  "loyaltyAdjustPointsLabel",
  "loyaltySaved",
  "loyaltySaveFailed",
  // Batch 3 — accessibility labels / CTA
  "loyaltyMembersSearchLabel",
  "loyaltyEnrollSearchLabel",
  "loyaltyEnrollCta",
] as const;

/** Collect every literal translation key the Phase 2 sources ask for. */
function collectPhase2Keys(): string[] {
  const files = [...PHASE2_SOURCES];
  for (const f of readdirSync("src/components/loyalty")) {
    if (f.endsWith(".tsx")) files.push(`src/components/loyalty/${f}`);
  }
  const keys = new Set<string>();
  for (const f of files) {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    for (const m of src.matchAll(/\bt(?:Template)?\(\s*lang\s*,\s*"([A-Za-z0-9_]+)"/g)) {
      keys.add(m[1]);
    }
    for (const m of src.matchAll(/loyaltyErrorKey\(\s*"([A-Za-z0-9_]+)"/g)) {
      keys.add(m[1]);
    }
  }
  // Keys fed through the error mapper / dialog defaults.
  const errorMap = readFileSync(join(process.cwd(), "src/lib/loyalty/loyaltyErrorMessages.ts"), "utf8");
  for (const m of errorMap.matchAll(/:\s*"([A-Za-z0-9_]+)"/g)) keys.add(m[1]);
  keys.add("loyaltyErrGeneric");
  keys.add("notifyPermissionDenied");
  keys.add("confirm");
  keys.add("cancel");
  return [...keys].sort();
}

const PLACEHOLDER_RE = /\{[A-Za-z0-9_]+\}/g;
const placeholders = (value: string) => (value.match(PLACEHOLDER_RE) ?? []).sort();

function expectResolves(lang: "en" | "lg" | "sw", key: string): string {
  const value = t(lang, key);
  expect(value, `${lang}.${key} missing`).toBeTruthy();
  expect(value, `${lang}.${key} leaks the raw key`).not.toBe(key);
  expect(value.trim(), `${lang}.${key} is empty`).not.toBe("");
  return value;
}

describe("Phase 2 Loyalty translations (Batch 4)", () => {
  const keys = collectPhase2Keys();

  it("derives a meaningful Phase 2 key set from source", () => {
    expect(keys.length).toBeGreaterThan(300);
  });

  it("every Phase 2 key resolves in en, lg and sw without leaking the raw key", () => {
    for (const key of keys) {
      expectResolves("en", key);
      expectResolves("lg", key);
      expectResolves("sw", key);
    }
  });

  it("every Phase 2 key is genuinely translated in lg and sw (no English fallback)", () => {
    for (const key of keys) {
      if (BRAND_OR_CODE_KEYS.has(key)) continue;
      const en = t("en", key);
      expect(t("lg", key), `lg.${key} is still English`).not.toBe(en);
      expect(t("sw", key), `sw.${key} is still English`).not.toBe(en);
    }
  });

  it("required Phase 2 keys resolve and are translated in every language", () => {
    for (const key of REQUIRED_PHASE2_KEYS) {
      const en = expectResolves("en", key);
      const lg = expectResolves("lg", key);
      const sw = expectResolves("sw", key);
      expect(lg, `lg.${key} untranslated`).not.toBe(en);
      expect(sw, `sw.${key} untranslated`).not.toBe(en);
    }
  });

  it("placeholders survive translation exactly", () => {
    for (const key of keys) {
      const expected = placeholders(t("en", key));
      expect(placeholders(t("lg", key)), `lg placeholders differ for ${key}`).toEqual(expected);
      expect(placeholders(t("sw", key)), `sw placeholders differ for ${key}`).toEqual(expected);
    }
  });

  it("every RPC error code maps to human-readable text in all languages", () => {
    const errorMap = readFileSync(
      join(process.cwd(), "src/lib/loyalty/loyaltyErrorMessages.ts"),
      "utf8",
    );
    const mappedKeys = new Set<string>(["loyaltyErrGeneric", "notifyPermissionDenied"]);
    for (const m of errorMap.matchAll(/:\s*"([A-Za-z0-9_]+)"/g)) mappedKeys.add(m[1]);
    expect(mappedKeys.size).toBeGreaterThan(15);
    for (const key of mappedKeys) {
      const en = expectResolves("en", key);
      expect(t("lg", key), `lg error text for ${key} untranslated`).not.toBe(en);
      expect(t("sw", key), `sw error text for ${key} untranslated`).not.toBe(en);
      // The raw RPC codes are snake_case; the message must never be the code.
      expect(en).not.toMatch(/^[a-z]+(_[a-z]+)+$/);
    }
  });
});
