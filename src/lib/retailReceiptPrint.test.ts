import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "../data/defaultSeed";
import type { Sale, ShopPreferences } from "../types";
import type { SaleReceiptContext } from "./receiptDocuments";

const persistMock = vi.fn();
const flushMock = vi.fn();
const processQueueMock = vi.fn();
const detectCapsMock = vi.fn();

let prefsRef: ShopPreferences = createDefaultPreferences();

vi.mock("../offline/printPayloadStore", () => ({
  persistPrintPayload: (...args: unknown[]) => persistMock(...args),
  loadPrintPayload: vi.fn(),
  deletePrintPayload: vi.fn(),
  hasPrintPayload: vi.fn(async () => true),
}));

vi.mock("../services/hardware/printerAdapter", () => ({
  detectPrinterCapabilities: (...args: unknown[]) => detectCapsMock(...args),
  sendEscPosBytes: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../store/usePosStore", () => ({
  flushPendingPersist: (...args: unknown[]) => flushMock(...args),
  usePosStore: {
    getState: () => ({
      preferences: prefsRef,
      processPendingPrintQueue: processQueueMock,
    }),
    setState: (partial: { preferences?: ShopPreferences }) => {
      if (partial.preferences) prefsRef = partial.preferences;
    },
  },
}));

import { tryEnqueueRetailSaleReceiptEscPos } from "./retailReceiptPrint";
import { printSaleReceipt } from "./receiptDocuments";

vi.mock("./documentPrint", () => ({
  printHtmlDocument: vi.fn(() => true),
}));

vi.mock("./nativePrintPlatform", () => ({
  isNativePrintPlatform: () => false,
}));

import { printHtmlDocument } from "./documentPrint";

const sale: Sale = {
  id: "sale-retail-1",
  createdAt: "2026-08-25T12:00:00.000Z",
  lines: [
    {
      productId: "p1",
      name: "Soap",
      quantity: 1,
      unitPriceUgx: 2000,
      unitCostUgx: 1000,
      lineTotalUgx: 2000,
      estimatedProfitUgx: 1000,
      inputMode: "quantity",
      voided: false,
    },
  ],
  subtotalUgx: 2000,
  totalUgx: 2000,
  cashPaidUgx: 2000,
  debtUgx: 0,
  discountTotalUgx: 0,
  estimatedProfitUgx: 1000,
  pendingSync: false,
  status: "completed",
};

function saleCtx(): SaleReceiptContext {
  return {
    shopName: "Waka Test",
    cashier: "Amina",
    receiptNumber: "INV-1",
    sale,
    labels: {
      cashier: "Cashier",
      items: "Items",
      total: "Total",
      paid: "Paid",
      debtSale: "Debt",
      balance: "Balance",
      time: "Time",
      outstandingDebt: "Outstanding",
      customer: "Customer",
      customerNotRecorded: "N/A",
      receiptNo: "Receipt",
      date: "Date",
      method: "Method",
      change: "Change",
      subtotal: "Subtotal",
      discount: "Discount",
      grandTotal: "Grand total",
    },
  };
}

function withReceiptPrinter(paperWidth: "58mm" | "80mm" = "80mm"): ShopPreferences {
  const prefs = createDefaultPreferences();
  prefs.hospitalityHardware = {
    printers: [
      {
        id: "printer-receipt-1",
        name: "Front counter",
        connectionType: "network",
        paperWidth,
        stationRoles: ["receipt"],
        isDefaultReceipt: true,
        isEnabled: true,
        networkHost: "192.168.1.50",
        networkPort: 9100,
      },
    ],
    printQueue: [],
    printHistory: [],
    receiptTemplate: {
      kind: "restaurant",
      showTableNumber: true,
      showWaiter: true,
      showGuests: true,
      showModifiers: true,
      showDiscounts: true,
      showSplitSummary: true,
      showQrPlaceholder: false,
    },
    autoPrintKitchen: true,
    autoPrintReceipt: true,
    openDrawerOnPayment: true,
    customerDisplayEnabled: false,
    drawerAudit: [],
  };
  return prefs;
}

function withBluetoothPrinter(): ShopPreferences {
  const prefs = withReceiptPrinter();
  prefs.hospitalityHardware!.printers[0] = {
    id: "printer-bt-1",
    name: "Mobile Printer",
    connectionType: "bluetooth",
    paperWidth: "58mm",
    stationRoles: ["receipt"],
    isDefaultReceipt: true,
    isEnabled: true,
    pairedDeviceKey: "classic:AA:BB:CC:DD:EE:FF",
    bluetoothTransport: "classic",
    pairedDeviceName: "Mobile Printer",
  };
  return prefs;
}

describe("Phase 1B retail ESC/POS wiring", () => {
  beforeEach(() => {
    persistMock.mockReset();
    flushMock.mockReset();
    processQueueMock.mockReset();
    detectCapsMock.mockReset();
    vi.mocked(printHtmlDocument).mockClear();
    prefsRef = createDefaultPreferences();
    detectCapsMock.mockResolvedValue({
      bluetoothAvailable: false,
      usbAvailable: false,
      networkAvailable: true,
      sunmiBuiltIn: false,
      escPosAvailable: true,
      platform: "electron",
      state: "PARTIAL",
      stateReason: "ok",
    });
  });

  it("does not enqueue when no default receipt printer is configured", async () => {
    const result = await tryEnqueueRetailSaleReceiptEscPos(saleCtx());
    expect(result.enqueued).toBe(false);
    expect(persistMock).not.toHaveBeenCalled();
    expect(processQueueMock).not.toHaveBeenCalled();
  });

  it("falls through when transport cannot deliver ESC/POS", async () => {
    prefsRef = withReceiptPrinter();
    detectCapsMock.mockResolvedValue({
      bluetoothAvailable: false,
      usbAvailable: false,
      networkAvailable: false,
      sunmiBuiltIn: false,
      escPosAvailable: false,
      platform: "android",
      state: "PARTIAL",
      stateReason: "Native thermal SDK not installed.",
    });
    const result = await tryEnqueueRetailSaleReceiptEscPos(saleCtx());
    expect(result.enqueued).toBe(false);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("enqueues kind:receipt via existing queue when printer + transport ok", async () => {
    prefsRef = withReceiptPrinter("58mm");
    const result = await tryEnqueueRetailSaleReceiptEscPos(saleCtx());
    expect(result.enqueued).toBe(true);
    expect(persistMock).toHaveBeenCalledTimes(1);
    const [, bytes] = persistMock.mock.calls[0] as [string, Uint8Array];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(20);
    expect(prefsRef.hospitalityHardware?.printQueue).toHaveLength(1);
    const job = prefsRef.hospitalityHardware!.printQueue[0]!;
    expect(job.kind).toBe("receipt");
    expect(job.printerId).toBe("printer-receipt-1");
    expect(job.saleId).toBe("sale-retail-1");
    expect(flushMock).toHaveBeenCalled();
    expect(processQueueMock).toHaveBeenCalled();
  });

  it("printSaleReceipt prefers thermal enqueue and skips HTML when enqueued", async () => {
    prefsRef = withReceiptPrinter();
    const result = await printSaleReceipt(saleCtx());
    expect(result.ok).toBe(true);
    expect(persistMock).toHaveBeenCalled();
    expect(printHtmlDocument).not.toHaveBeenCalled();
  });

  it("printSaleReceipt keeps HTML path when thermal cannot enqueue", async () => {
    prefsRef = createDefaultPreferences();
    const result = await printSaleReceipt(saleCtx());
    expect(result.ok).toBe(true);
    expect(persistMock).not.toHaveBeenCalled();
    expect(printHtmlDocument).toHaveBeenCalled();
  });

  it("does not enqueue Classic Bluetooth from a browser so HTML print can run", async () => {
    prefsRef = withBluetoothPrinter();
    detectCapsMock.mockResolvedValue({
      bluetoothAvailable: true,
      usbAvailable: false,
      networkAvailable: false,
      sunmiBuiltIn: false,
      escPosAvailable: true,
      nativeBluetoothPrinter: false,
      platform: "web",
      state: "PARTIAL",
      stateReason: "Web Bluetooth only",
      transports: {
        environment: "desktop-browser",
        bluetooth: {
          classic: { supported: false, available: false, transportReady: false, reason: "classic" },
          ble: { supported: true, available: true, transportReady: false, reason: "api" },
          native: false,
          webBluetooth: true,
        },
        usb: {
          native: { supported: false, available: false, transportReady: false, reason: "no" },
          webUsb: { supported: true, available: true, transportReady: false, reason: "api" },
        },
        network: {
          electron: { supported: false, available: false, transportReady: false, reason: "no" },
          androidNative: { supported: false, available: false, transportReady: false, reason: "no" },
          browserDirect: { supported: false, available: false, transportReady: false, reason: "no" },
        },
      },
    });
    const result = await printSaleReceipt(saleCtx());
    expect(result.ok).toBe(true);
    expect(persistMock).not.toHaveBeenCalled();
    expect(printHtmlDocument).toHaveBeenCalled();
  });
});
