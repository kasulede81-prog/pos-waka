import { describe, expect, it } from "vitest";
import type { DebtPayment } from "../types";
import {
  mergeDebtPaymentsFromCloudPull,
  parseDebtPaymentRows,
  rowToDebtPayment,
} from "./debtPaymentRecovery";

const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAY_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAY_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("debtPaymentPullSync", () => {
  it("parses cloud row into DebtPayment", () => {
    const row = rowToDebtPayment({
      id: PAY_A,
      customer_id: CUSTOMER_ID,
      amount_ugx: 25_000,
      created_at: "2026-06-11T10:00:00.000Z",
    });
    expect(row).toEqual({
      id: PAY_A,
      customerId: CUSTOMER_ID,
      amountUgx: 25_000,
      createdAt: "2026-06-11T10:00:00.000Z",
    });
  });

  it("merge never duplicates by payment id", () => {
    const local: DebtPayment[] = [
      {
        id: PAY_A,
        customerId: CUSTOMER_ID,
        amountUgx: 25_000,
        createdAt: "2026-06-11T10:00:00.000Z",
        receiptHeaderSnapshot: { lines: ["Local header"] },
      },
    ];
    const remote: DebtPayment[] = [
      {
        id: PAY_A,
        customerId: CUSTOMER_ID,
        amountUgx: 25_000,
        createdAt: "2026-06-11T10:00:00.000Z",
      },
      {
        id: PAY_B,
        customerId: CUSTOMER_ID,
        amountUgx: 10_000,
        createdAt: "2026-06-11T11:00:00.000Z",
      },
    ];
    const merged = mergeDebtPaymentsFromCloudPull(local, remote);
    expect(merged).toHaveLength(2);
    expect(merged.find((p) => p.id === PAY_A)?.receiptHeaderSnapshot?.lines).toEqual(["Local header"]);
    expect(merged.find((p) => p.id === PAY_B)?.amountUgx).toBe(10_000);
  });

  it("hydrates empty local from remote pull", () => {
    const remote = parseDebtPaymentRows([
      {
        id: PAY_A,
        customer_id: CUSTOMER_ID,
        amount_ugx: 40_000,
        created_at: "2026-06-11T09:00:00.000Z",
      },
    ]);
    const merged = mergeDebtPaymentsFromCloudPull([], remote);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.amountUgx).toBe(40_000);
  });
});
