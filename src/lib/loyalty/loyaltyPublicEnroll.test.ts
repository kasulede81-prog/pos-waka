import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLoyaltyJoinUrl } from "./loyaltyPublicEnroll";
import { isPublicLoyaltyJoinPath } from "../nativeApp";

const TOKEN = "a".repeat(64);

describe("Decision 028 public enroll helpers", () => {
  it("builds join URL distinct from public card URL", () => {
    const url = buildLoyaltyJoinUrl(TOKEN);
    expect(url).toContain(`/join/${TOKEN}`);
    expect(url).not.toContain(`/c/`);
  });

  it("recognizes /join/:token public path", () => {
    expect(isPublicLoyaltyJoinPath(`/join/${TOKEN}`)).toBe(true);
    expect(isPublicLoyaltyJoinPath(`/c/${TOKEN}`)).toBe(false);
    expect(isPublicLoyaltyJoinPath("/join/short")).toBe(false);
  });

  it("edge enroll ignores client shop_id authority", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/functions/loyalty-public-enroll/index.ts"),
      "utf8",
    );
    expect(src).toMatch(/void body\.shop_id/);
    expect(src).toMatch(/loyalty_enroll_by_enrollment_token/);
    expect(src).toMatch(/enforceEnrollSubmitRateLimit/);
  });

  it("migration keeps enrollment token separate from public_card_token", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/migrations/20260924170000_loyalty_public_self_enrollment.sql"),
      "utf8",
    );
    expect(src).toMatch(/loyalty_enrollment_links/);
    expect(src).toMatch(/loyalty_enroll_by_enrollment_token/);
    expect(src).toMatch(/already_member/);
    expect(src).toMatch(/enroll_join/);
    expect(src).toMatch(/enroll_submit/);
  });
});
