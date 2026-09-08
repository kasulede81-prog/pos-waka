import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "../data/defaultSeed";
import type { ReturnRecord, Sale, ShopPreferences } from "../types";
import type { ReturnReceiptContext } from "./receiptDocuments";

const persistMock = vi.fn();
const flushMock = vi.fn();
const processQueueMock = vi.fn();
const detectCapsMock = vi.fn();
const returnProductMock = vi.fn();

let prefsRef: ShopPreferences = createDefaultPreferences();
const pendingReturns: Array<{ kind: string }> = [{ kind: "pending_returns" }];
const sales: Sale[] = [];
const returnRecords: ReturnRecord[] = [];
const stockOnHand = { coke: 11 };
const cashInDrawerUgx = 100_000;
const debtBalanceUgx = 5_000;

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
      returnProduct: returnProductMock,
      sales,
      returnRecords,
      pendingReturns,
      stockOnHand,
      cashInDrawerUgx,
      debtBalanceUgx,
    }),
    setState: (partial: { preferences?: ShopPreferences }) => {
      if (partial.preferences) prefsRef = partial.preferences;
    },
  },
}));

import { tryEnqueueReturnReceiptEscPos } from "./returnReceiptPrint";
import { printReturnReceipt } from "./receiptDocuments";

vi.mock("./documentPrint", () => ({
  printHtmlDocument: vi.fn(() => true),
}));

vi.mock("./nativePrintPlatform", () => ({
  isNativePrintPlatform: () => false,
}));

import { printHtmlDocument } from "./documentPrint";

const returnRecord: ReturnRecord = {
  id: "ret-print-1",
  saleId: "sale-linked-1",
  productId: "p1",
  productName: "Coke 500ml",
  quantity: 1,
  refundAmountUgx: 12_500,
  refundCashUgx: 12_500,
  cogsUgx: 6_000,
  reason: "wrong_item",
  note: "Shelf mix-up",
  actorUserId: "user-1",
  actorName: "Amina",
  createdAt: "2026-08-25T12:00:00.000Z",
};

const unlinkedReturn: ReturnRecord = {
  ...returnRecord,
  id: "ret-print-unlinked",
  saleId: null,
};

function returnCtx(rec: ReturnRecord = returnRecord): ReturnReceiptContext {
  return {
    shopName: "Waka Test",
    cashier: "Amina",
    receiptNumber: "RET-20260825-RETPRI",
    returnRecord: rec,
    customerName: "John Doe",
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

describe("Return receipt ESC/POS wiring", () => {
  beforeEach(() => {
    persistMock.mockReset();
    flushMock.mockReset();
    processQueueMock.mockReset();
    detectCapsMock.mockReset();
    returnProductMock.mockReset();
    vi.mocked(printHtmlDocument).mockClear();
    prefsRef = createDefaultPreferences();
    sales.length = 0;
    returnRecords.length = 0;
    pendingReturns.splice(0, pendingReturns.length, { kind: "pending_returns" });
    stockOnHand.coke = 11;
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
    const recBefore = structuredClone(returnRecord);
    const result = await tryEnqueueReturnReceiptEscPos(returnCtx());
    expect(result).toEqual({ enqueued: false, nativePrinterConfigured: false });
    expect(persistMock).not.toHaveBeenCalled();
    expect(processQueueMock).not.toHaveBeenCalled();
    expect(returnRecord).toEqual(recBefore);
  });

  it("printReturnReceipt keeps HTML fallback when no printer exists", async () => {
    const result = await printReturnReceipt(returnCtx());
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("html");
    expect(persistMock).not.toHaveBeenCalled();
    expect(printHtmlDocument).toHaveBeenCalled();
    expect(returnProductMock).not.toHaveBeenCalled();
  });

  it("enqueues kind:receipt on the default receipt printer", async () => {
    prefsRef = withReceiptPrinter("58mm");
    const recBefore = structuredClone(returnRecord);
    const pendingBefore = structuredClone(pendingReturns);
    const result = await tryEnqueueReturnReceiptEscPos(returnCtx());
    expect(result).toEqual({ enqueued: true, nativePrinterConfigured: true });
    expect(persistMock).toHaveBeenCalledTimes(1);
    const [, bytes] = persistMock.mock.calls[0] as [string, Uint8Array];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(20);
    expect(prefsRef.hospitalityHardware?.printQueue).toHaveLength(1);
    const job = prefsRef.hospitalityHardware!.printQueue[0]!;
    expect(job.kind).toBe("receipt");
    expect(job.printerId).toBe("printer-receipt-1");
    expect(job.saleId).toBe("sale-linked-1");
    expect(job.payloadSummary).toContain("Return receipt");
    expect(flushMock).toHaveBeenCalled();
    expect(processQueueMock).toHaveBeenCalled();
    expect(returnRecord).toEqual(recBefore);
    expect(pendingReturns).toEqual(pendingBefore);
    expect(sales).toEqual([]);
    expect(stockOnHand.coke).toBe(11);
    expect(cashInDrawerUgx).toBe(100_000);
    expect(debtBalanceUgx).toBe(5_000);
    expect(returnProductMock).not.toHaveBeenCalled();
  });

  it("stores linked saleId as queue metadata only and does not invent saleId when unlinked", async () => {
    prefsRef = withReceiptPrinter();
    await tryEnqueueReturnReceiptEscPos(returnCtx());
    expect(prefsRef.hospitalityHardware!.printQueue[0]!.saleId).toBe("sale-linked-1");

    prefsRef = withReceiptPrinter();
    const unlinked = await tryEnqueueReturnReceiptEscPos(returnCtx(unlinkedReturn));
    expect(unlinked.enqueued).toBe(true);
    expect(prefsRef.hospitalityHardware!.printQueue[0]!.saleId).toBeNull();
  });

  it("printReturnReceipt prefers thermal enqueue and skips HTML when enqueued", async () => {
    prefsRef = withReceiptPrinter();
    const result = await printReturnReceipt(returnCtx());
    expect(result).toEqual({ ok: true, mode: "thermal" });
    expect(persistMock).toHaveBeenCalled();
    expect(printHtmlDocument).not.toHaveBeenCalled();
  });

  it("does not open HTML when a native printer is configured but enqueue fails", async () => {
    prefsRef = withReceiptPrinter("58mm");
    persistMock.mockRejectedValueOnce(new Error("payload store unavailable"));
    const recBefore = structuredClone(returnRecord);
    const result = await printReturnReceipt(returnCtx());
    expect(result.ok).toBe(false);
    expect(result.mode).toBe("thermal");
    expect(printHtmlDocument).not.toHaveBeenCalled();
    expect(returnRecord).toEqual(recBefore);
    expect(returnProductMock).not.toHaveBeenCalled();
    expect(pendingReturns).toEqual([{ kind: "pending_returns" }]);
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
    const result = await printReturnReceipt(returnCtx());
    expect(result.ok).toBe(true);
    expect(persistMock).not.toHaveBeenCalled();
    expect(printHtmlDocument).toHaveBeenCalled();
  });
});
