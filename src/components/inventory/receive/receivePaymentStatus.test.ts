import { describe, expect, it } from "vitest";
import { paidUgxForReceiveStatus, receivePayStatusFromAmounts } from "./receivePaymentStatus";

describe("receivePayStatusFromAmounts", () => {
  it("treats zero paid as unpaid", () => {
    expect(receivePayStatusFromAmounts(500_000, 0)).toBe("unpaid");
  });

  it("treats full pay as paid", () => {
    expect(receivePayStatusFromAmounts(500_000, 500_000)).toBe("paid");
  });

  it("treats mid pay as partial", () => {
    expect(receivePayStatusFromAmounts(500_000, 200_000)).toBe("partial");
  });
});

describe("paidUgxForReceiveStatus", () => {
  it("forces unpaid to 0 and paid to invoice total", () => {
    expect(paidUgxForReceiveStatus("unpaid", 500_000, 99)).toBe(0);
    expect(paidUgxForReceiveStatus("paid", 500_000, 1)).toBe(500_000);
  });

  it("keeps typed amount for partial", () => {
    expect(paidUgxForReceiveStatus("partial", 500_000, 200_000)).toBe(200_000);
  });

  it("clamps partial pay to the invoice total", () => {
    expect(paidUgxForReceiveStatus("partial", 500_000, 900_000)).toBe(500_000);
  });
});
