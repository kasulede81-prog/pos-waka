/**
 * Printing audit — native-safety contract for the shared receipt fallback ladder.
 *
 * Verifies the two things the audit found broken on Android:
 *   1. native goes to the share sheet with a real PDF (never a silent no-op), and
 *   2. a failed print is reported as a failure — it never throws and never reaches
 *      into sales, stock, or money.
 *
 * These tests also execute the real jsPDF builders, which is what proves the
 * generated documents are non-empty on the installed jsPDF major version.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "../data/defaultSeed";

const mocks = vi.hoisted(() => ({
  isNative: vi.fn(() => false),
  printHtmlDocument: vi.fn(() => true),
  saveExportedFile: vi.fn(async (_filename: string, _blob: Blob, _mime: string) => true),
}));

vi.mock("./nativePrintPlatform", () => ({ isNativePrintPlatform: mocks.isNative }));
vi.mock("./fileDownload", () => ({ saveExportedFile: mocks.saveExportedFile }));
vi.mock("./documentPrint", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./documentPrint")>()),
  printHtmlDocument: mocks.printHtmlDocument,
}));

import { printReceiptFallback } from "./receiptNativeFallback";
import { printPrescriptionSummary } from "./pharmacyPrescriptionPrint";
import { printPatientSummary } from "./pharmacyPatientPrint";
import { printPharmacyComplianceReport } from "./pharmacyComplianceDocument";
import { printSampleReceipt } from "./receiptSampleDocument";
import { printTransferDeliveryNote } from "./transferDeliveryNote";
import { buildRestaurantBillPreviewPlain, printRestaurantBillPreview } from "./restaurantBillPreviewDocument";
import type { Customer, PharmacyPrescription } from "../types";

/** Size of the PDF blob handed to the share sheet on the most recent call. */
function lastSharedBlobSize(): number {
  const calls = mocks.saveExportedFile.mock.calls;
  const last = calls[calls.length - 1];
  expect(last, "saveExportedFile was never called").toBeTruthy();
  const blob = last![1] as Blob;
  expect(blob).toBeInstanceOf(Blob);
  return blob.size;
}

const customer = {
  id: "c1",
  name: "Amina Nakato",
  phone: "+256700000000",
  debtBalanceUgx: 0,
} as unknown as Customer;

const prescription = {
  prescriptionNumber: "RX-000123",
  patientName: "Amina Nakato",
  doctorName: "Dr. Okello",
  prescriptionDate: "2026-09-26",
  lines: [
    {
      productId: "p1",
      productName: "Amoxicillin",
      strength: "500mg",
      quantityPrescribed: 21,
      directions: "TDS x 7 days",
    },
  ],
} as unknown as PharmacyPrescription;

describe("receipt fallback ladder", () => {
  beforeEach(() => {
    mocks.isNative.mockReturnValue(false);
    mocks.printHtmlDocument.mockReturnValue(true);
    mocks.saveExportedFile.mockClear();
  });

  it("prints in the browser on web/desktop", async () => {
    const result = await printReceiptFallback({ plainText: "RECEIPT", html: "<article>r</article>" });
    expect(result).toEqual({ ok: true, mode: "html" });
    expect(mocks.printHtmlDocument).toHaveBeenCalled();
    expect(mocks.saveExportedFile).not.toHaveBeenCalled();
  });

  it("shares a PDF on native instead of attempting a WebView print", async () => {
    mocks.isNative.mockReturnValue(true);
    const result = await printReceiptFallback({ plainText: "RECEIPT\nline", html: "<article>r</article>" });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("share");
    expect(mocks.printHtmlDocument).not.toHaveBeenCalled();
    expect(lastSharedBlobSize()).toBeGreaterThan(0);
  });

  it("reports failure instead of throwing when no print path works (web)", async () => {
    mocks.printHtmlDocument.mockReturnValue(false);
    const result = await printReceiptFallback({ plainText: "RECEIPT" });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe("none");
    expect(result.error).toBeTruthy();
  });

  it("reports failure instead of throwing when the share sheet cannot open (native)", async () => {
    mocks.isNative.mockReturnValue(true);
    mocks.saveExportedFile.mockResolvedValue(false);
    const result = await printReceiptFallback({ plainText: "RECEIPT" });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe("none");
  });
});

describe("native-safe document builders produce real PDFs", () => {
  beforeEach(() => {
    mocks.isNative.mockReturnValue(true);
    mocks.saveExportedFile.mockResolvedValue(true);
    mocks.saveExportedFile.mockClear();
  });

  it("patient summary", async () => {
    const ok = await printPatientSummary("en", customer, createDefaultPreferences());
    expect(ok).toBe(true);
    expect(lastSharedBlobSize()).toBeGreaterThan(0);
  });

  it("prescription summary", async () => {
    const ok = await printPrescriptionSummary("en", prescription, createDefaultPreferences());
    expect(ok).toBe(true);
    expect(lastSharedBlobSize()).toBeGreaterThan(0);
  });

  it("controlled-drug compliance register", async () => {
    const prefs = createDefaultPreferences();
    const ok = await printPharmacyComplianceReport({
      lang: "en",
      shopName: "Waka Pharmacy",
      shopAddress: null,
      shopPhone: null,
      scope: "full_bundle",
      dayKey: "2026-09-26",
      bundle: {
        dailyControlled: [],
        dispensingRegister: [],
        returns: [],
        destroyed: [],
        overrides: [],
        witnessLog: [],
        controlledStockHints: [{ productId: "p1", productName: "Morphine", dispensedQty: 4 }],
      },
    });
    expect(prefs).toBeTruthy();
    expect(ok).toBe(true);
    expect(lastSharedBlobSize()).toBeGreaterThan(0);
  });

  it("receipt template sample", async () => {
    const ok = await printSampleReceipt("en", createDefaultPreferences(), "waka_plus");
    expect(ok.ok).toBe(true);
    expect(lastSharedBlobSize()).toBeGreaterThan(0);
  });

  it("transfer delivery note", async () => {
    const ok = await printTransferDeliveryNote({
      lang: "en",
      transferId: "12345678-1234-1234-1234-123456789012",
      status: "in_transit",
      fromShopLabel: "Main Branch",
      toShopLabel: "Kikuubo",
      createdAt: "2026-09-26T08:00:00.000Z",
      shippedAt: "2026-09-26T09:00:00.000Z",
      reason: "restock",
      lines: [{ productName: "Sugar 1kg", quantity: 10, receivedQuantity: 0, unitCostUgx: 4000 }],
    });
    expect(ok).toBe(true);
    expect(lastSharedBlobSize()).toBeGreaterThan(0);
  });
});

describe("restaurant bill preview is presentation only", () => {
  beforeEach(() => {
    mocks.isNative.mockReturnValue(true);
    mocks.saveExportedFile.mockResolvedValue(true);
    mocks.saveExportedFile.mockClear();
  });

  const input = {
    lang: "en" as const,
    shopName: "Waka Restaurant",
    headerLine: null,
    tableLabel: "Table 4",
    areaName: "Terrace",
    guestCount: 2,
    waiterLabel: "Joan",
    lines: [{ id: "l1", name: "Grilled Tilapia", quantity: 2, lineTotalUgx: 40000 }],
    listSubtotalUgx: 40000,
    discountUgx: 0,
    serviceChargeUgx: 4000,
    tipUgx: 0,
    grandTotalUgx: 44000,
    payments: [],
    remainingBalanceUgx: 44000,
    footerNote: null,
  };

  it("builds a bill check without mutating its input", async () => {
    const snapshot = JSON.parse(JSON.stringify(input));
    const text = buildRestaurantBillPreviewPlain(input);
    expect(text).toContain("Table 4");
    // Resolved label, not a raw i18n key — this paper goes to the guest.
    expect(text).toContain("Grand Total");
    const result = await printRestaurantBillPreview(input);
    expect(result.ok).toBe(true);
    // No settlement, no payment, no stock: the input object is untouched.
    expect(input).toEqual(snapshot);
    expect(lastSharedBlobSize()).toBeGreaterThan(0);
  });
});
