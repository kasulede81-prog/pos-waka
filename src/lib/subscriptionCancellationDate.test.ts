import { describe, expect, it } from "vitest";
import {
  isCancelledStatus,
  parseKampalaWallClock,
  resolveSubscriptionCancelledAt,
} from "./subscriptionCancellationDate";
import type { RemoteSubscriptionRow } from "./subscriptionEntitlements";

function row(over: Partial<RemoteSubscriptionRow>): RemoteSubscriptionRow {
  return {
    id: "s1",
    organization_id: "o1",
    shop_id: "sh1",
    status: "active",
    trial_ends_at: null,
    current_period_start: null,
    current_period_end: null,
    plan_code: "business",
    max_pos_users: null,
    max_shops: null,
    max_devices: null,
    ...over,
  };
}

describe("parseKampalaWallClock — the stamp has no offset, so we supply one", () => {
  it("reads a Kampala wall clock as UTC+3, not as the device's local time", () => {
    // `timezone('Africa/Kampala', now())::text` — the format admin_subscription_set_status
    // stores. 14:05 in Kampala is 11:05 UTC. A bare `new Date(...)` would read this in
    // whatever zone the device is in and silently shift the instant.
    expect(parseKampalaWallClock("2026-10-13 14:05:00")).toBe("2026-10-13T11:05:00.000Z");
  });

  it("tolerates fractional seconds and a T separator, truncating to the second", () => {
    // Postgres emits microseconds; the parser keeps whole seconds on purpose (the value is
    // only rendered at day granularity, and truncation cannot move it across a day).
    expect(parseKampalaWallClock("2026-10-13 14:05:00.123456")).toBe("2026-10-13T11:05:00.000Z");
    expect(parseKampalaWallClock("2026-10-13T14:05:00")).toBe("2026-10-13T11:05:00.000Z");
  });

  it("returns null for anything it cannot read, rather than guessing", () => {
    expect(parseKampalaWallClock(null)).toBeNull();
    expect(parseKampalaWallClock(undefined)).toBeNull();
    expect(parseKampalaWallClock("")).toBeNull();
    expect(parseKampalaWallClock("not a date")).toBeNull();
    expect(parseKampalaWallClock("13/10/2026")).toBeNull();
    expect(parseKampalaWallClock(1_760_000_000)).toBeNull();
  });
});

describe("resolveSubscriptionCancelledAt — only when the records actually say", () => {
  it("reads the recorded stamp for a cancelled row", () => {
    const r = row({ status: "cancelled", metadata: { status_set_at: "2026-10-13 14:05:00" } });
    expect(resolveSubscriptionCancelledAt(r)).toBe("2026-10-13T11:05:00.000Z");
  });

  it("accepts either spelling of cancelled", () => {
    const r = row({ status: "canceled", metadata: { status_set_at: "2026-10-13 14:05:00" } });
    expect(resolveSubscriptionCancelledAt(r)).toBe("2026-10-13T11:05:00.000Z");
  });

  it("REFUSES the stamp on a row that is not cancelled", () => {
    // The whole reason this function exists. `status_set_at` is written for EVERY status
    // the RPC sets — active, paused, trial — and the row does not record which status it
    // belongs to. Only the current `status` says that. A row paused yesterday and read
    // today carries the PAUSE stamp; showing it as a cancellation date would be invention.
    expect(
      resolveSubscriptionCancelledAt(
        row({ status: "paused", metadata: { status_set_at: "2026-10-13 14:05:00" } }),
      ),
    ).toBeNull();
    expect(
      resolveSubscriptionCancelledAt(
        row({ status: "active", metadata: { status_set_at: "2026-10-13 14:05:00" } }),
      ),
    ).toBeNull();
  });

  it("returns null for a cancelled row with no stamp, instead of inventing one", () => {
    // The plan-RPC sibling sweep and a reset-to-free cancel without writing any stamp.
    // `updated_at` is the only trace there and it is NOT the cancellation instant — any
    // later write moves it — so there is no date to show.
    expect(resolveSubscriptionCancelledAt(row({ status: "cancelled", metadata: {} }))).toBeNull();
    expect(resolveSubscriptionCancelledAt(row({ status: "cancelled", metadata: null }))).toBeNull();
    expect(resolveSubscriptionCancelledAt(row({ status: "cancelled" }))).toBeNull();
  });

  it("returns null when the stamp is present but unreadable", () => {
    const r = row({ status: "cancelled", metadata: { status_set_at: "yesterday" } });
    expect(resolveSubscriptionCancelledAt(r)).toBeNull();
  });
});

describe("isCancelledStatus", () => {
  it("is case- and whitespace-insensitive", () => {
    expect(isCancelledStatus("  Cancelled ")).toBe(true);
    expect(isCancelledStatus("CANCELED")).toBe(true);
    expect(isCancelledStatus("cancelled")).toBe(true);
  });

  it("is false for every other status, including the near-misses", () => {
    for (const s of ["active", "paused", "expired", "trial", "past_due", "", null, undefined]) {
      expect(isCancelledStatus(s)).toBe(false);
    }
  });
});
