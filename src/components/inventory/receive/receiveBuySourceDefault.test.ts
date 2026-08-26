import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { WALK_IN_SUPPLIER_ID } from "../../../lib/walkInSupplier";
import { defaultReceiveBuySource, namedSuppliersForReceive } from "./receiveBuySourceDefault";
import { paidUgxForReceiveStatus } from "./receivePaymentStatus";
import { t } from "../../../lib/i18n";

const here = dirname(fileURLToPath(import.meta.url));

describe("defaultReceiveBuySource (UX default only)", () => {
  it("defaults to supplier when a named supplier exists", () => {
    expect(
      defaultReceiveBuySource([
        { id: "sup-a" },
        { id: WALK_IN_SUPPLIER_ID },
      ]),
    ).toBe("supplier");
  });

  it("defaults to town when only walk-in / empty", () => {
    expect(defaultReceiveBuySource([])).toBe("town");
    expect(defaultReceiveBuySource([{ id: WALK_IN_SUPPLIER_ID }])).toBe("town");
  });

  it("does not invent business amounts — paid helpers still require explicit status", () => {
    expect(paidUgxForReceiveStatus("unpaid", 1_000_000, 400_000)).toBe(0);
    expect(paidUgxForReceiveStatus("partial", 1_000_000, 400_000)).toBe(400_000);
    expect(paidUgxForReceiveStatus("paid", 1_000_000, 0)).toBe(1_000_000);
  });

  it("namedSuppliersForReceive excludes walk-in", () => {
    expect(
      namedSuppliersForReceive([{ id: "a" }, { id: WALK_IN_SUPPLIER_ID }, { id: "b" }]).map((s) => s.id),
    ).toEqual(["a", "b"]);
  });
});

describe("restockPaidHint guidance", () => {
  it("exists in i18n and describes remaining balance owed", () => {
    const hint = t("en", "restockPaidHint");
    expect(hint.toLowerCase()).toMatch(/owe|owed|still/);
    expect(hint.length).toBeGreaterThan(20);
  });

  it("is rendered in ReceiveTotalsPanel when partial-payment UI is shown", () => {
    const src = readFileSync(join(here, "ReceiveTotalsPanel.tsx"), "utf8");
    expect(src).toContain('t(lang, "restockPaidHint")');
    expect(src).toContain("showPartialPayment");
  });
});

describe("receive default wiring", () => {
  it("RestockPage uses defaultReceiveBuySource for initial source", () => {
    const src = readFileSync(join(here, "../../../pages/RestockPage.tsx"), "utf8");
    expect(src).toContain("defaultReceiveBuySource");
    expect(src).not.toMatch(/useState<\w*>\("town"\)/);
  });
});

describe("supplier detail pay reuse", () => {
  it("SupplierDetailPage reuses addSupplierPayment and Pay supplier label", () => {
    const src = readFileSync(join(here, "../../../pages/SupplierDetailPage.tsx"), "utf8");
    expect(src).toContain("addSupplierPayment");
    expect(src).toContain('t(lang, "supplierPayButton")');
    expect(src).toContain("supplier.payment");
    expect(src).not.toMatch(/recordPurchase/);
  });
});
