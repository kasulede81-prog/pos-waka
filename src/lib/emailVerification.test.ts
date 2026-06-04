import { describe, expect, it } from "vitest";
import { isSupabaseEmailVerified } from "./emailVerification";
import type { User } from "@supabase/supabase-js";

function user(partial: Partial<User>): User {
  return partial as User;
}

describe("isSupabaseEmailVerified", () => {
  it("returns true when email_confirmed_at is set", () => {
    expect(
      isSupabaseEmailVerified(
        user({ email_confirmed_at: "2026-01-01T00:00:00Z" } as User),
      ),
    ).toBe(true);
  });

  it("returns true for Google OAuth without separate confirmation", () => {
    expect(
      isSupabaseEmailVerified(
        user({
          app_metadata: { provider: "google" },
          identities: [{ provider: "google", id: "1" } as never],
        }),
      ),
    ).toBe(true);
  });

  it("returns false for unverified email/password signup", () => {
    expect(
      isSupabaseEmailVerified(
        user({
          email_confirmed_at: undefined,
          app_metadata: { provider: "email" },
          identities: [{ provider: "email", id: "1" } as never],
        }),
      ),
    ).toBe(false);
  });
});
