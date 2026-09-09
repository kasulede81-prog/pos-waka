/**
 * R4 — `maxIsoTimestamp` must compare timestamptz instants, not ISO text.
 *
 * AUDIT FINDING (R4, P2):
 *   Lexicographic compare of `…000Z` vs PostgREST `…000000+00:00` treats `'Z'`
 *   as greater than `'0'`/`'1'`, so an equal or slightly later server timestamp
 *   does not become the max and the same page is re-pulled.
 */

import { describe, expect, it } from "vitest";
import { maxIsoTimestamp } from "./maxIsoTimestamp";

const Z = "2026-01-01T12:00:00Z";
const Z_MS = "2026-01-01T12:00:00.000Z";
const OFFSET_ZERO = "2026-01-01T12:00:00+00:00";
const OFFSET_ZERO_US = "2026-01-01T12:00:00.000000+00:00";
const OFFSET_PLUS_3 = "2026-01-01T15:00:00+03:00";
const OFFSET_MINUS_3 = "2026-01-01T09:00:00-03:00";
const EARLIER = "2026-01-01T11:59:59.999Z";
const LATER = "2026-01-01T12:00:00.001Z";
const LATER_US = "2026-01-01T12:00:00.000001+00:00";

describe("R4 — maxIsoTimestamp compares instants", () => {
  it("1 — Z and +00:00 at the same instant do not advance the maximum", () => {
    expect(maxIsoTimestamp(Z, OFFSET_ZERO)).toBe(Z);
    expect(maxIsoTimestamp(Z_MS, OFFSET_ZERO_US)).toBe(Z_MS);
    expect(maxIsoTimestamp(OFFSET_ZERO_US, Z_MS)).toBe(OFFSET_ZERO_US);
  });

  it("2 — the same instant with different offsets does not advance the maximum", () => {
    expect(maxIsoTimestamp(Z, OFFSET_PLUS_3)).toBe(Z);
    expect(maxIsoTimestamp(Z, OFFSET_MINUS_3)).toBe(Z);
    expect(maxIsoTimestamp(OFFSET_PLUS_3, OFFSET_MINUS_3)).toBe(OFFSET_PLUS_3);
  });

  it("3 — a clearly earlier timestamp is rejected", () => {
    expect(maxIsoTimestamp(Z_MS, EARLIER)).toBe(Z_MS);
    expect(maxIsoTimestamp(OFFSET_ZERO_US, EARLIER)).toBe(OFFSET_ZERO_US);
  });

  it("4 — a clearly later timestamp is adopted", () => {
    expect(maxIsoTimestamp(Z_MS, LATER)).toBe(LATER);
    expect(maxIsoTimestamp(OFFSET_ZERO, LATER)).toBe(LATER);
  });

  it("4b — a later microsecond on +00:00 advances past a Z millisecond cursor", () => {
    // The audit stall: string compare has `'Z' > '1'`, so this used to keep Z.
    expect(LATER_US > Z_MS).toBe(false);
    expect(maxIsoTimestamp(Z_MS, LATER_US)).toBe(LATER_US);
    expect(maxIsoTimestamp(LATER_US, Z_MS)).toBe(LATER_US);
  });

  it("5 — empty / null / non-string candidates keep the current value", () => {
    expect(maxIsoTimestamp(Z_MS, "")).toBe(Z_MS);
    expect(maxIsoTimestamp(Z_MS, null)).toBe(Z_MS);
    expect(maxIsoTimestamp(Z_MS, undefined)).toBe(Z_MS);
    expect(maxIsoTimestamp(Z_MS, 1)).toBe(Z_MS);
    expect(maxIsoTimestamp(Z_MS, { iso: Z })).toBe(Z_MS);
    expect(maxIsoTimestamp(Z_MS, "not-a-timestamp")).toBe(Z_MS);
  });

  it("5b — a valid candidate replaces an empty / unparseable current", () => {
    expect(maxIsoTimestamp("", Z_MS)).toBe(Z_MS);
    expect(maxIsoTimestamp("not-a-timestamp", OFFSET_ZERO_US)).toBe(OFFSET_ZERO_US);
  });

  it("6 — folding many timestamps returns a latest-instant original string", () => {
    const folded = [OFFSET_ZERO_US, EARLIER, OFFSET_PLUS_3, LATER_US, Z_MS, OFFSET_MINUS_3].reduce(
      (current, candidate) => maxIsoTimestamp(current, candidate),
      Z_MS,
    );
    expect(folded).toBe(LATER_US);
  });

  it("does not rewrite the winning timestamp through the client clock", () => {
    const won = maxIsoTimestamp(Z_MS, OFFSET_ZERO_US);
    expect(won === Z_MS || won === OFFSET_ZERO_US).toBe(true);
    expect(won.endsWith("Z") || won.includes("+00:00")).toBe(true);
  });
});
