import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "../data/defaultSeed";
import type { Customer, DebtPayment, ShopPreferences } from "../types";
import type { DebtPaymentReceiptContext } from "./receiptDocuments";

const persistMock = vi.fn();
const flushMock = vi.fn();
const processQueueMock = vi.fn();
const detectCapsMock = vi.fn();
const addDebtPaymentMock = vi.fn();

let prefsRef: ShopPreferences = createDefaultPreferences();
const debtPayments: DebtPayment[] = [];
const customers: Customer[] = [];
const cashInDrawerUgx = { value: 100_000 };
const pendingCustomerOps: Array<{ kind: string; paymentId?: string }> = [{ kind: "customer_sync" }];

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
      addDebtPayment: addDebtPaymentMock,
      customers,
      debtPayments,
      cashInDrawerUgx: cashInDrawerUgx.value,
      pendingOps: pendingCustomerOps,
    }),
    setState: (partial: { preferences?: ShopPreferences }) => {
      if (partial.preferences) prefsRef = partial.preferences;
    },
  },
}));

import { tryEnqueueDebtReceiptEscPos } from "./debtReceiptPrint";
import { printDebtPaymentReceipt } from "./receiptDocuments";
import { columnsForWidth } from "./escPosBuilder";
import { dateKeyKampala } from "./datesUg";

vi.mock("./documentPrint", () => ({
  printHtmlDocument: vi.fn(() => true),
}));

vi.mock("./nativePrintPlatform", () => ({
  isNativePrintPlatform: () => false,
}));

import { printHtmlDocument } from "./documentPrint";
import * as debtPaymentPush from "./debtPaymentPush";

const payment: DebtPayment = {
  id: "pay-print-1",
  customerId: "c1",
  amountUgx: 10_000,
  createdAt: "2026-08-25T12:00:00.000Z",
};

const customer: Customer = {
  id: "c1",
  name: "John Doe",
  phone: "0700",
  location: "Kampala",
  debtBalanceUgx: 5_000,
  createdAt: "2026-01-01T00:00:00.000Z",
  version: 2,
};

function debtCtx(pay: DebtPayment = payment, cust: Customer = customer): DebtPaymentReceiptContext {
  return {
    shopName: "Waka Test",
    cashier: "Amina",
    receiptNumber: "DEBT-20260825-PAYPRI",
    payment: pay,
    customer: cust,
    balanceAfterUgx: 5_000,
    headerLines: ["Waka Test"],
    footerLines: ["Thank you"],
    footerPowered: "Powered by Waka POS",
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

function decodeEscPosText(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x1b) {
      const next = bytes[i + 1];
      if (next === 0x74 || next === 0x61 || next === 0x45 || next === 0x64) {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (b === 0x1d) {
      const next = bytes[i + 1];
      if (next === 0x21) {
        i += 2;
        continue;
      }
      if (next === 0x56) {
        i += 3;
        continue;
      }
      i += 1;
      continue;
    }
    if (b === 0x0a) {
      out += "\n";
      continue;
    }
    if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
  }
  return out;
}

function contentLines(bytes: Uint8Array): string[] {
  return decodeEscPosText(bytes).split("\n").filter((line) => line.length > 0);
}

describe("Debt payment receipt ESC/POS wiring", () => {
  beforeEach(() => {
    persistMock.mockReset();
    flushMock.mockReset();
    processQueueMock.mockReset();
    detectCapsMock.mockReset();
    addDebtPaymentMock.mockReset();
    vi.mocked(printHtmlDocument).mockClear();
    prefsRef = createDefaultPreferences();
    debtPayments.splice(0, debtPayments.length, { ...payment });
    customers.splice(0, customers.length, { ...customer });
    cashInDrawerUgx.value = 100_000;
    pendingCustomerOps.splice(0, pendingCustomerOps.length, { kind: "customer_sync" });
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
    const payBefore = structuredClone(payment);
    const custBefore = structuredClone(customer);
    const result = await tryEnqueueDebtReceiptEscPos(debtCtx());
    expect(result).toEqual({ enqueued: false, nativePrinterConfigured: false });
    expect(persistMock).not.toHaveBeenCalled();
    expect(processQueueMock).not.toHaveBeenCalled();
    expect(payment).toEqual(payBefore);
    expect(customer).toEqual(custBefore);
    expect(addDebtPaymentMock).not.toHaveBeenCalled();
  });

  it("printDebtPaymentReceipt keeps HTML fallback when no printer exists", async () => {
    const result = await printDebtPaymentReceipt(debtCtx());
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("html");
    expect(persistMock).not.toHaveBeenCalled();
    expect(printHtmlDocument).toHaveBeenCalled();
    expect(addDebtPaymentMock).not.toHaveBeenCalled();
  });

  it("enqueues kind:receipt on the default receipt printer with saleId null", async () => {
    prefsRef = withReceiptPrinter("58mm");
    const payBefore = structuredClone(payment);
    const custBefore = structuredClone(customers[0]);
    const pendingBefore = structuredClone(pendingCustomerOps);
    const rpcSpy = vi.spyOn(debtPaymentPush, "buildDebtPaymentRpcPayload");
    const result = await tryEnqueueDebtReceiptEscPos(debtCtx());
    expect(result).toEqual({ enqueued: true, nativePrinterConfigured: true });
    expect(persistMock).toHaveBeenCalledTimes(1);
    const [, bytes] = persistMock.mock.calls[0] as [string, Uint8Array];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(20);
    expect(prefsRef.hospitalityHardware?.printQueue).toHaveLength(1);
    const job = prefsRef.hospitalityHardware!.printQueue[0]!;
    expect(job.kind).toBe("receipt");
    expect(job.kind).not.toBe("debt");
    expect(job.printerId).toBe("printer-receipt-1");
    expect(job.saleId).toBeNull();
    expect(job.businessDate).toBe(dateKeyKampala(payment.createdAt));
    expect(job.payloadSummary).toContain("Debt receipt");
    expect(flushMock).toHaveBeenCalled();
    expect(processQueueMock).toHaveBeenCalled();
    expect(payment).toEqual(payBefore);
    expect(customers[0]).toEqual(custBefore);
    expect(debtPayments).toEqual([payBefore]);
    expect(pendingCustomerOps).toEqual(pendingBefore);
    expect(cashInDrawerUgx.value).toBe(100_000);
    expect(addDebtPaymentMock).not.toHaveBeenCalled();
    expect(rpcSpy).not.toHaveBeenCalled();
    rpcSpy.mockRestore();
  });

  it("passes printer.paperWidth into ESC/POS bytes", async () => {
    expect(columnsForWidth("58mm")).toBe(32);
    expect(columnsForWidth("80mm")).toBe(42);

    prefsRef = withReceiptPrinter("58mm");
    await tryEnqueueDebtReceiptEscPos(debtCtx());
    const [, bytes58] = persistMock.mock.calls[0] as [string, Uint8Array];
    expect(contentLines(bytes58).every((line) => line.length <= 32)).toBe(true);

    persistMock.mockClear();
    prefsRef = withReceiptPrinter("80mm");
    await tryEnqueueDebtReceiptEscPos(debtCtx());
    const [, bytes80] = persistMock.mock.calls[0] as [string, Uint8Array];
    expect(contentLines(bytes80).every((line) => line.length <= 42)).toBe(true);
    expect(Array.from(bytes58)).not.toEqual(Array.from(bytes80));
  });

  it("printDebtPaymentReceipt prefers thermal enqueue and skips HTML when enqueued", async () => {
    prefsRef = withReceiptPrinter();
    const result = await printDebtPaymentReceipt(debtCtx());
    expect(result).toEqual({ ok: true, mode: "thermal" });
    expect(persistMock).toHaveBeenCalled();
    expect(printHtmlDocument).not.toHaveBeenCalled();
  });

  it("does not open HTML when a native printer is configured but enqueue fails", async () => {
    prefsRef = withReceiptPrinter("58mm");
    persistMock.mockRejectedValueOnce(new Error("payload store unavailable"));
    const payBefore = structuredClone(payment);
    const result = await printDebtPaymentReceipt(debtCtx());
    expect(result.ok).toBe(false);
    expect(result.mode).toBe("thermal");
    expect(printHtmlDocument).not.toHaveBeenCalled();
    expect(payment).toEqual(payBefore);
    expect(addDebtPaymentMock).not.toHaveBeenCalled();
    expect(pendingCustomerOps).toEqual([{ kind: "customer_sync" }]);
    expect(customers[0]!.debtBalanceUgx).toBe(5_000);
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
    const result = await printDebtPaymentReceipt(debtCtx());
    expect(result.ok).toBe(true);
    expect(persistMock).not.toHaveBeenCalled();
    expect(printHtmlDocument).toHaveBeenCalled();
  });
});
