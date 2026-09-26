/**
 * Printing phase 2 — coverage for the P2/P3 printing items.
 *
 * The five new report surfaces (cash variance history, pharmacy inventory, pharmacy
 * patient, inventory count sheet, menu) all print through the shared list-document
 * renderer, so its behaviour is asserted once here. The remaining tests cover the
 * feedback rules and the USB / no-printer states that the phase-2 items asked to
 * make explicit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryCountSession, Language } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";

const mocks = vi.hoisted(() => ({
  isNative: vi.fn(() => false),
  printHtmlDocument: vi.fn(() => true),
  saveExportedFile: vi.fn(async (_f: string, _b: Blob, _m: string) => true),
}));

vi.mock("./nativePrintPlatform", () => ({ isNativePrintPlatform: mocks.isNative }));
vi.mock("./fileDownload", () => ({ saveExportedFile: mocks.saveExportedFile }));
vi.mock("./documentPrint", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./documentPrint")>()),
  printHtmlDocument: mocks.printHtmlDocument,
}));

import { buildListDocumentHtml, buildListDocumentPdfBlob } from "./listDocumentPdf";
import { pdfExportFeedback, receiptPrintFeedback } from "./printFeedback";
import {
  buildInventoryCountSheetPdfBlob,
  printInventoryCountVarianceReport,
} from "./inventoryCountExport";
import { buildCashVarianceDocument, cashVarianceRangeLabel } from "./cashVarianceDocument";
import { buildMenuDocument } from "./menuDocument";
import { resolveDefaultReceiptPrinter } from "./printerRegistry";
import { getHardwareTransportCapabilities, USB_NOT_SUPPORTED_ERROR } from "../services/hardware/hardwareTransport";

const LANGS: Language[] = ["en", "lg", "sw"];

function sessionWith(overrides?: Partial<InventoryCountSession>): InventoryCountSession {
  return {
    id: "s1",
    sessionNumber: 7,
    status: "counting",
    startedAt: "2026-09-26T08:00:00.000Z",
    startedBy: "u1",
    submittedAt: null,
    submittedBy: null,
    approvedAt: null,
    approvedBy: null,
    appliedAt: null,
    appliedBy: null,
    snapshotCreatedAt: "2026-09-26T08:00:00.000Z",
    notes: "",
    pendingSync: false,
    updatedAt: "2026-09-26T08:00:00.000Z",
    lines: [
      {
        id: "l1",
        sessionId: "s1",
        productId: "p1",
        productName: "Sugar 1kg",
        expectedQtySnapshot: 12,
        countedQty: null,
        varianceQty: 0,
        varianceCostUgx: 0,
        varianceRetailUgx: 0,
        reason: "",
        updatedAt: "2026-09-26T08:00:00.000Z",
      },
      {
        id: "l2",
        sessionId: "s1",
        productId: "p2",
        productName: "Soap",
        expectedQtySnapshot: 5,
        countedQty: 3,
        varianceQty: -2,
        varianceCostUgx: -2000,
        varianceRetailUgx: -3000,
        reason: "damaged",
        updatedAt: "2026-09-26T08:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("shared list document renderer (cash variance, pharmacy inventory/patient, menu)", () => {
  it("renders a non-empty A4 PDF", () => {
    const blob = buildListDocumentPdfBlob({
      title: "Drawer variance history",
      subtitle: "N & C trading center",
      lines: ["2026-09-25  UGX -3,000", "2026-09-26  [!] UGX 12,000"],
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("escapes HTML and keeps every line in the printable body", () => {
    const html = buildListDocumentHtml({
      title: "Menu <script>alert(1)</script>",
      subtitle: null,
      lines: ["Tilapia & chips  —  UGX 40,000"],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Tilapia &amp; chips");
    expect(html).toContain("UGX 40,000");
  });

  it("renders an empty report without throwing", () => {
    const blob = buildListDocumentPdfBlob({ title: "Empty report", subtitle: null, lines: [] });
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe("inventory count sheet and variance report", () => {
  beforeEach(() => {
    mocks.isNative.mockReturnValue(true);
    mocks.saveExportedFile.mockResolvedValue(true);
    mocks.saveExportedFile.mockClear();
  });

  it("builds a count sheet while lines are still uncounted", () => {
    const blob = buildInventoryCountSheetPdfBlob("en", sessionWith(), "Waka Shop");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("printing the count sheet does not mutate the session or its lines", () => {
    const session = sessionWith();
    const snapshot = JSON.parse(JSON.stringify(session));
    buildInventoryCountSheetPdfBlob("en", session, "Waka Shop");
    expect(session).toEqual(snapshot);
  });

  it("shares the variance report PDF on native", async () => {
    const session = sessionWith({ status: "applied", appliedAt: "2026-09-26T10:00:00.000Z" });
    const ok = await printInventoryCountVarianceReport("en", session, "Waka Shop");
    expect(ok).toBe(true);
    const calls = mocks.saveExportedFile.mock.calls;
    const blob = calls[calls.length - 1]![1];
    expect(blob.size).toBeGreaterThan(0);
  });

  it("reports failure instead of throwing when the share sheet cannot open", async () => {
    mocks.saveExportedFile.mockResolvedValue(false);
    const ok = await printInventoryCountVarianceReport("en", sessionWith(), "Waka Shop");
    expect(ok).toBe(false);
  });
});

describe("print failure feedback", () => {
  it("never reports success when the print returned ok:false", () => {
    const failures = [
      { ok: false, mode: "thermal" },
      { ok: false, mode: "html" },
      { ok: false, mode: "share" },
      { ok: false, mode: "none" },
      { ok: false, mode: "handoff" },
    ];
    for (const lang of LANGS) {
      for (const outcome of failures) {
        const feedback = receiptPrintFeedback(lang, outcome);
        expect(feedback.kind).toBe("error");
        expect(feedback.message).toBeTruthy();
      }
      expect(pdfExportFeedback(lang, false).kind).toBe("error");
      expect(pdfExportFeedback(lang, false).message).toBeTruthy();
    }
  });

  it("distinguishes an unreachable printer from having no print path at all", () => {
    const thermal = receiptPrintFeedback("en", { ok: false, mode: "thermal", error: "Printer did not respond." });
    const none = receiptPrintFeedback("en", { ok: false, mode: "none" });
    expect(thermal.message).toBe("Printer did not respond.");
    expect(none.message).not.toBe(thermal.message);
  });

  it("reports the delivery path when the print succeeded", () => {
    expect(receiptPrintFeedback("en", { ok: true, mode: "thermal" }).kind).toBe("success");
    expect(receiptPrintFeedback("en", { ok: true, mode: "share" }).kind).toBe("success");
    expect(receiptPrintFeedback("en", { ok: true, mode: "thermal" }).message).toBeTruthy();
    expect(receiptPrintFeedback("en", { ok: true, mode: "share" }).message).toBeTruthy();
  });
});

describe("cash drawer without a receipt printer", () => {
  it("has no default receipt printer when none is configured", () => {
    const prefs = createDefaultPreferences();
    // The drawer pulses through this printer, so this null is what gates the warning.
    expect(resolveDefaultReceiptPrinter(prefs)).toBeNull();
  });
});

describe("cash variance history document", () => {
  const rows = [
    { id: "c2", dateKey: "2026-09-26", differenceUgx: 12000, flagged: true },
    { id: "c1", dateKey: "2026-09-25", differenceUgx: -3000, flagged: false },
  ];

  it("states the window covered by the displayed rows", () => {
    expect(cashVarianceRangeLabel(rows)).toBe("2026-09-25 – 2026-09-26");
    expect(cashVarianceRangeLabel([rows[0]!])).toBe("2026-09-26");
    expect(cashVarianceRangeLabel([])).toBe("—");
  });

  it("prints the rows it was given, newest first, with a flag marker", () => {
    const doc = buildCashVarianceDocument({ lang: "en", shopName: "N & C trading center", rows });
    expect(doc.subtitle).toBe("N & C trading center");
    expect(doc.title).toBeTruthy();
    const body = doc.lines.join("\n");
    expect(body).toContain("[!]");
    expect(doc.lines.some((l) => l.startsWith("Date:"))).toBe(true);
    // Data rows stay newest-first (the range header mentions both dates, so match rows only).
    const rowLines = doc.lines.filter((l) => /^2026-09-2\d\s/.test(l));
    expect(rowLines).toHaveLength(2);
    expect(rowLines[0]).toContain("2026-09-26");
    expect(rowLines[1]).toContain("2026-09-25");
  });

  it("does not mutate the rows it prints", () => {
    const snapshot = JSON.parse(JSON.stringify(rows));
    buildCashVarianceDocument({ lang: "en", shopName: "Shop", rows });
    expect(rows).toEqual(snapshot);
  });
});

describe("menu document", () => {
  const prefs = createDefaultPreferences();

  it("groups dishes by section and carries the menuReports aggregates", () => {
    const doc = buildMenuDocument({
      lang: "en",
      preferences: prefs,
      menuProducts: [
        { id: "p1", name: "Grilled Tilapia", category: "Mains", sellingPricePerUnitUgx: 40000, menu: { menuSection: "mains" } },
        { id: "p2", name: "Chapati", category: "Sides", sellingPricePerUnitUgx: 1000, menu: { menuSection: "sides" } },
      ] as never,
      activeSectionLabel: "All sections",
      topDishes: [{ productId: "p1", productName: "Grilled Tilapia", quantitySold: 9, revenueUgx: 360000, profitUgx: 90000 }],
      topModifiers: [{ optionLabel: "Extra spicy", groupLabel: "Heat", count: 4 }],
      lowMargin: [{ product: { id: "p2", name: "Chapati" } as never, marginPct: 12 }],
    });
    const body = doc.lines.join("\n");
    expect(body).toContain("Grilled Tilapia");
    expect(body).toContain("UGX 40,000");
    expect(body).toContain("Extra spicy: 4");
    expect(body).toContain("Chapati: 12%");
    expect(doc.subtitle).toContain("All sections");
  });
});

describe("USB thermal printing is explicitly unsupported, not faked", () => {
  it("reports the transport as unsupported and never ready", async () => {
    const caps = await getHardwareTransportCapabilities();
    expect(caps.usb.webUsb.supported).toBe(false);
    expect(caps.usb.webUsb.transportReady).toBe(false);
    expect(caps.usb.native.transportReady).toBe(false);
  });

  it("gives the operator an actionable reason", async () => {
    const caps = await getHardwareTransportCapabilities();
    const reason = caps.usb.webUsb.reason;
    expect(reason).toBe(USB_NOT_SUPPORTED_ERROR);
    // Actionable: points at a supported alternative.
    expect(reason).toMatch(/Bluetooth|network/i);
  });
});
