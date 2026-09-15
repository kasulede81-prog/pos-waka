import { describe, expect, it, vi, beforeEach } from "vitest";
import { createDefaultPreferences } from "../data/defaultSeed";
import { enqueuePrintJob, processPrintQueue } from "./printQueue";

const persistMock = vi.fn();
const loadMock = vi.fn();
const deleteMock = vi.fn();
const hasMock = vi.fn();

vi.mock("../offline/printPayloadStore", () => ({
  persistPrintPayload: (...args: unknown[]) => persistMock(...args),
  loadPrintPayload: (...args: unknown[]) => loadMock(...args),
  deletePrintPayload: (...args: unknown[]) => deleteMock(...args),
  hasPrintPayload: (...args: unknown[]) => hasMock(...args),
}));

vi.mock("../services/hardware/printerAdapter", () => ({
  sendEscPosBytes: vi.fn(async () => ({ ok: true })),
}));

describe("printQueue durability", () => {
  beforeEach(() => {
    persistMock.mockReset();
    loadMock.mockReset();
    deleteMock.mockReset();
    hasMock.mockReset();
    loadMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    hasMock.mockResolvedValue(true);
  });

  it("persists payload when enqueueing", async () => {
    const prefs = createDefaultPreferences();
    prefs.hospitalityHardware = {
      printers: [
        {
          id: "p1",
          name: "Kitchen",
          connectionType: "usb",
          paperWidth: "80mm",
          stationRoles: ["kitchen"],
          isEnabled: true,
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
    const bytes = new Uint8Array([9, 9, 9]);
    const next = await enqueuePrintJob(prefs, {
      kind: "kitchen_chit_new",
      printerId: "p1",
      payloadSummary: "Test chit",
      bytes,
    });
    expect(persistMock).toHaveBeenCalled();
    expect(next.hospitalityHardware?.printQueue).toHaveLength(1);
    expect(next.hospitalityHardware?.printQueue[0]?.payloadPersisted).toBe(true);
  });

  it("loads payload from store when processing", async () => {
    const prefs = createDefaultPreferences();
    const jobId = "job-1";
    prefs.hospitalityHardware = {
      printers: [
        {
          id: "p1",
          name: "Kitchen",
          connectionType: "usb",
          paperWidth: "80mm",
          stationRoles: ["kitchen"],
          isEnabled: true,
        },
      ],
      printQueue: [
        {
          id: jobId,
          kind: "kitchen_chit_new",
          printerId: "p1",
          status: "queued",
          attempts: 0,
          maxAttempts: 5,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          payloadSummary: "Chit",
          payloadPersisted: true,
        },
      ],
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
    const after = await processPrintQueue(prefs, 1);
    expect(loadMock).toHaveBeenCalledWith(jobId);
    expect(after.hospitalityHardware?.printQueue).toHaveLength(0);
    expect(after.hospitalityHardware?.printHistory[0]?.status).toBe("done");
  });
});
