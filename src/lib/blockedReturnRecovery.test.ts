import { describe, expect, it } from "vitest";
import {
  cloudReturnAlreadySynced,
  hasBlockedReturnRecoveryAttempt,
  idSuffix,
  markBlockedReturnRecoveryAttempted,
  readLastBlockedReturnProbe,
  recordBlockedReturnProbe,
  resetBlockedReturnRecoveryForTests,
} from "./blockedReturnRecovery";

describe("blocked return recovery bookkeeping", () => {
  it("suffixes ids without emitting the full value", () => {
    expect(idSuffix("436fb9c2-6584-4d65-a5d9-4c2a1c95fcaf")).toBe("fcaf");
    expect(idSuffix("")).toBe("");
  });

  it("records a ceiling failure without marking an RPC attempt", () => {
    resetBlockedReturnRecoveryForTests();
    expect(
      recordBlockedReturnProbe({
        ok: false,
        blocker: "ceiling",
        ceilingError: "refund_exceeds_remaining",
        cloudSaleTotalUgx: 1000,
        saleRowPresent: true,
        queueIdSuffix: "fcaf",
      }),
    ).toBe(false);
    expect(readLastBlockedReturnProbe()?.ceilingError).toBe("refund_exceeds_remaining");
    expect(hasBlockedReturnRecoveryAttempt("436fb9c2-6584-4d65-a5d9-4c2a1c95fcaf")).toBe(false);
  });

  it("matches an already-synced cloud return by id, sale, product, qty, and refund", () => {
    const row = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      saleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      quantity: 1,
      refundAmountUgx: 1000,
    };
    expect(
      cloudReturnAlreadySynced({
        returnId: row.id,
        saleId: row.saleId,
        productId: row.productId,
        quantity: row.quantity,
        refundUgx: row.refundAmountUgx,
        cloudReturns: [row],
      }),
    ).toBe(true);
  });

  it("does not match a missing, mismatched, or empty cloud return", () => {
    const row = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      saleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      quantity: 1,
      refundAmountUgx: 1000,
    };
    expect(
      cloudReturnAlreadySynced({
        returnId: row.id,
        saleId: row.saleId,
        productId: row.productId,
        quantity: 1,
        refundUgx: 1000,
        cloudReturns: [],
      }),
    ).toBe(false);
    expect(
      cloudReturnAlreadySynced({
        returnId: row.id,
        saleId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        productId: row.productId,
        quantity: 1,
        refundUgx: 1000,
        cloudReturns: [row],
      }),
    ).toBe(false);
    expect(
      cloudReturnAlreadySynced({
        returnId: "",
        saleId: row.saleId,
        productId: row.productId,
        quantity: 1,
        refundUgx: 1000,
        cloudReturns: [row],
      }),
    ).toBe(false);
  });

  it("marks at most one RPC attempt per queue id until reset", () => {
    resetBlockedReturnRecoveryForTests();
    const id = "436fb9c2-6584-4d65-a5d9-4c2a1c95fcaf";
    expect(hasBlockedReturnRecoveryAttempt(id)).toBe(false);
    markBlockedReturnRecoveryAttempted(id);
    expect(hasBlockedReturnRecoveryAttempt(id)).toBe(true);
    markBlockedReturnRecoveryAttempted(id);
    expect(hasBlockedReturnRecoveryAttempt(id)).toBe(true);
    resetBlockedReturnRecoveryForTests();
    expect(hasBlockedReturnRecoveryAttempt(id)).toBe(false);
  });
});
