import { describe, expect, it } from "vitest";
import {
  buildDebtPaymentReceiptPdfBlob,
  buildReturnReceiptPdfBlob,
  buildSaleReceiptPdfBlob,
} from "./receiptPdfDocuments";
import { documentReceiptNumber } from "./receiptDocuments";
import { buildPlainReceiptPdfBlob } from "./nativeReceiptPrint";
import type { Customer, DebtPayment, ReturnRecord, Sale } from "../types";

const sale: Sale = {
  id: "sale-abc12345",
  createdAt: "2026-06-02T10:00:00.000Z",
  lines: [
    {
      productId: "p1",
      name: "Soap",
      quantity: 2,
      unitPriceUgx: 500,
      unitCostUgx: 300,
      lineTotalUgx: 1000,
      estimatedProfitUgx: 400,
      inputMode: "quantity",
      voided: false,
    },
  ],
  subtotalUgx: 1000,
  totalUgx: 1000,
  cashPaidUgx: 1000,
  debtUgx: 0,
  discountTotalUgx: 0,
  estimatedProfitUgx: 400,
  pendingSync: false,
  status: "completed",
  soldByUserId: "local:owner",
};

describe("receiptPdf", () => {
  it("builds sale receipt PDF blob", async () => {
    const blob = await buildSaleReceiptPdfBlob({
      shopName: "Test Shop",
      cashier: "Jane",
      receiptNumber: "001",
      sale,
      labels: {
        cashier: "Cashier",
        items: "Items",
        total: "Total",
        paid: "Paid",
        debtSale: "Debt",
        balance: "Balance",
        time: "Time",
        outstandingDebt: "Outstanding Debt",
        customer: "Customer",
        customerNotRecorded: "Not Recorded",
        receiptNo: "Receipt No",
        date: "Date",
        method: "Method",
        change: "Change",
        subtotal: "Subtotal",
        discount: "Discount",
        grandTotal: "Grand Total",
      },
      headerLines: ["Test Shop"],
      footerLines: ["Thank you"],
      displayOptions: {
        showCashier: true,
        showReceiptNumber: true,
        showPaymentMethod: true,
        showCustomerName: true,
        showCustomerPhone: true,
        showDebtInfo: true,
        showShopAddress: true,
        showShopPhone: true,
      },
    });
    expect(blob.size).toBeGreaterThan(500);
    expect(blob.type).toBe("application/pdf");
  });

  it("builds return receipt PDF blob", async () => {
    const ret: ReturnRecord = {
      id: "ret-1",
      productId: "p1",
      productName: "Soap",
      quantity: 1,
      refundAmountUgx: 500,
      reason: "damaged",
      actorUserId: "u1",
      createdAt: "2026-06-02T11:00:00.000Z",
    };
    const blob = await buildReturnReceiptPdfBlob({
      shopName: "Shop",
      receiptNumber: "R-1",
      returnRecord: ret,
      cashier: "Jane",
    });
    expect(blob.size).toBeGreaterThan(400);
  });

  it("builds debt payment receipt PDF blob", async () => {
    const payment: DebtPayment = {
      id: "pay-1",
      customerId: "c1",
      amountUgx: 2000,
      createdAt: "2026-06-02T12:00:00.000Z",
    };
    const customer: Customer = {
      id: "c1",
      name: "John",
      phone: "0700",
      location: "Kampala",
      debtBalanceUgx: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    };
    const blob = await buildDebtPaymentReceiptPdfBlob({
      shopName: "Shop",
      receiptNumber: "D-1",
      payment,
      customer,
      cashier: "Owner",
      balanceAfterUgx: 0,
    });
    expect(blob.size).toBeGreaterThan(400);
  });

  it("formats document receipt numbers", () => {
    const n = documentReceiptNumber("SAL", "abc-def-ghi", "2026-06-02T10:00:00.000Z");
    expect(n).toMatch(/^SAL-/);
    expect(n).toContain("ABC-DE");
  });

  it("builds plain text receipt PDF for native share/print", async () => {
    const blob = await buildPlainReceiptPdfBlob("Shop\n\nTotal: UGX 1,000\n", "80mm");
    expect(blob.size).toBeGreaterThan(200);
    expect(blob.type).toBe("application/pdf");
  });
});
