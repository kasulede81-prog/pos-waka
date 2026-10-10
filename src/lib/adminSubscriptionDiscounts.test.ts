import { describe, expect, it } from "vitest";
import {
  MAX_ADMIN_DISCOUNT_PERCENT,
  hasDiscountErrors,
  localDiscountPreview,
  mapDiscountError,
  normalizeDiscountPercent,
  parseDiscountPercent,
  validateDiscountDraft,
} from "./adminSubscriptionDiscounts";

describe("admin discount — percentage bounds", () => {
  it("accepts the whole intended range, endpoints included", () => {
    expect(parseDiscountPercent("0")).toEqual({ ok: true, value: 0 });
    expect(parseDiscountPercent("1")).toEqual({ ok: true, value: 1 });
    expect(parseDiscountPercent("90")).toEqual({ ok: true, value: 90 });
    expect(parseDiscountPercent("99")).toEqual({ ok: true, value: 99 });
  });

  it("accepts fractions, which the server rounds the same way", () => {
    expect(parseDiscountPercent("22.25")).toEqual({ ok: true, value: 22.25 });
    expect(parseDiscountPercent(" 12.5 ")).toEqual({ ok: true, value: 12.5 });
  });

  it("refuses anything above the 99% system maximum", () => {
    for (const raw of ["99.01", "100", "150", "1000"]) {
      const result = parseDiscountPercent(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain(String(MAX_ADMIN_DISCOUNT_PERCENT));
    }
  });

  it("refuses a negative discount", () => {
    const result = parseDiscountPercent("-1");
    expect(result.ok).toBe(false);
  });

  it("treats an empty field as missing, not as zero", () => {
    // Clearing the input is a mistake to correct; typing 0 is a deliberate
    // "no discount". They must not be the same value.
    expect(parseDiscountPercent("").ok).toBe(false);
    expect(parseDiscountPercent("   ").ok).toBe(false);
    expect(parseDiscountPercent("0")).toEqual({ ok: true, value: 0 });
  });

  it("refuses a non-number", () => {
    for (const raw of ["abc", "10%", "1e9999x"]) {
      expect(parseDiscountPercent(raw).ok).toBe(false);
    }
  });
});

describe("admin discount — windows", () => {
  it("accepts an open-ended window in either direction", () => {
    expect(hasDiscountErrors(validateDiscountDraft({ percentRaw: "25" }))).toBe(false);
    expect(
      hasDiscountErrors(validateDiscountDraft({ percentRaw: "25", startsAt: "2026-01-01T00:00:00Z" })),
    ).toBe(false);
    expect(
      hasDiscountErrors(validateDiscountDraft({ percentRaw: "25", expiresAt: "2027-01-01T00:00:00Z" })),
    ).toBe(false);
  });

  it("accepts a well-ordered window", () => {
    const errors = validateDiscountDraft({
      percentRaw: "25",
      startsAt: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
    });
    expect(hasDiscountErrors(errors)).toBe(false);
  });

  it("rejects an inverted window and says which rule was broken", () => {
    const errors = validateDiscountDraft({
      percentRaw: "25",
      startsAt: "2027-01-01T00:00:00Z",
      expiresAt: "2026-01-01T00:00:00Z",
    });
    expect(errors.window).toBeTruthy();
  });

  it("rejects a window whose ends are the same instant", () => {
    const errors = validateDiscountDraft({
      percentRaw: "25",
      startsAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-01T00:00:00Z",
    });
    expect(errors.window).toBeTruthy();
  });

  it("reports an unparseable date against its own field", () => {
    const errors = validateDiscountDraft({ percentRaw: "25", startsAt: "not-a-date" });
    expect(errors.start).toBeTruthy();
  });

  it("reports the percentage and the window together rather than stopping at the first", () => {
    const errors = validateDiscountDraft({
      percentRaw: "150",
      startsAt: "2027-01-01T00:00:00Z",
      expiresAt: "2026-01-01T00:00:00Z",
    });
    expect(errors.percent).toBeTruthy();
    expect(errors.window).toBeTruthy();
    expect(hasDiscountErrors(errors)).toBe(true);
  });
});

describe("admin discount — local preview arithmetic", () => {
  it("matches the server's rounding at the percentages that matter", () => {
    // The same cases the SQL contract pins, so the two cannot drift silently.
    expect(localDiscountPreview(36_000, 0)).toEqual({ discountUgx: 0, finalUgx: 36_000 });
    expect(localDiscountPreview(36_000, 1)).toEqual({ discountUgx: 360, finalUgx: 35_640 });
    expect(localDiscountPreview(36_000, 90)).toEqual({ discountUgx: 32_400, finalUgx: 3_600 });
    expect(localDiscountPreview(36_000, 99)).toEqual({ discountUgx: 35_640, finalUgx: 360 });
  });

  it("rounds half away from zero, as the server does", () => {
    expect(localDiscountPreview(36_000, 22.25).finalUgx).toBe(27_990);
    expect(localDiscountPreview(18_000, 33).finalUgx).toBe(12_060);
  });

  it("never returns a negative price", () => {
    expect(localDiscountPreview(36_000, 100).finalUgx).toBe(0);
    expect(localDiscountPreview(36_000, 150).finalUgx).toBe(0);
  });
});

describe("admin discount — normalization", () => {
  it("clamps to the system range", () => {
    expect(normalizeDiscountPercent(150)).toBe(99);
    expect(normalizeDiscountPercent(-5)).toBe(0);
    expect(normalizeDiscountPercent(42)).toBe(42);
  });
});

describe("admin discount — error copy", () => {
  it("turns a refusal into something an operator can act on", () => {
    expect(mapDiscountError('forbidden')).toContain("permission");
    expect(mapDiscountError("permission denied for function admin_plan_discount_save")).toContain("permission");
  });

  it("says the feature is unavailable rather than naming a PostgREST code", () => {
    const message = mapDiscountError("PGRST202 Could not find the function");
    expect(message).toContain("not available");
    expect(message).not.toContain("PGRST202");
  });

  it("passes through a server message it does not recognise", () => {
    expect(mapDiscountError("discount_out_of_range")).toBe("discount_out_of_range");
  });

  it("never returns an empty message", () => {
    expect(mapDiscountError("").length).toBeGreaterThan(0);
  });
});
