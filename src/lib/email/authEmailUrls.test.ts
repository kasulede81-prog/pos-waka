import { describe, expect, it } from "vitest";
import { buildAuthConfirmationUrl, isSyntheticPhoneLoginEmail } from "./authEmailUrls";

describe("buildAuthConfirmationUrl", () => {
  it("builds Supabase verify URL with token hash and redirect", () => {
    const url = buildAuthConfirmationUrl("https://abc.supabase.co", {
      token_hash: "hash123",
      email_action_type: "recovery",
      redirect_to: "https://pos.waka.ug/reset-password",
    });
    expect(url).toBe(
      "https://abc.supabase.co/auth/v1/verify?token=hash123&type=recovery&redirect_to=https%3A%2F%2Fpos.waka.ug%2Freset-password",
    );
  });
});

describe("isSyntheticPhoneLoginEmail", () => {
  it("detects login.waka.ug synthetic addresses", () => {
    expect(isSyntheticPhoneLoginEmail("256700000000@login.waka.ug")).toBe(true);
    expect(isSyntheticPhoneLoginEmail("owner@shop.com")).toBe(false);
  });
});
