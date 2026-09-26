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
    // Phase 2: the public POST queues a REQUEST; it must not reach the enroll RPC.
    expect(src).toMatch(/loyalty_request_enrollment/);
    expect(src).not.toMatch(/loyalty_enroll_by_enrollment_token/);
    expect(src).toMatch(/enforceEnrollSubmitRateLimit/);
  });

  it("the edge response never carries a card token for a pending request", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/functions/loyalty-public-enroll/index.ts"),
      "utf8",
    );
    // A card token would appear as a response KEY; the header comment's prose mention
    // of the guarantee is fine and stays.
    expect(src).not.toMatch(/public_card_token:/);
    expect(src).toMatch(/status: result\.status === "already_member" \? "already_member" : "pending"/);
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
