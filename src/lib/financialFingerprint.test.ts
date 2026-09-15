import { describe, expect, it, beforeEach } from "vitest";
import { usePosStore } from "../store/usePosStore";
import type { Sale, SaleLine } from "../types";
import {
  buildCloudTrustCertificationReport,
  readLocalFinancialFingerprint,
} from "./cloudTrustCenter";

const BASE_COUNTS = {
  products: 0,
  customers: 0,
  sales: 0,
  returns: 0,
  debtPayments: 0,
  expenses: 0,
  suppliers: 0,
  purchases: 0,
  supplierPayments: 0,
  cashAdjustments: 0,
  dayOpens: 0,
  shifts: 0,
  dayCloses: 0,
  inventoryCounts: 0,
  stockMovements: 0,
  staff: 0,
  auditLogs: 0,
};

function line(overrides: Partial<SaleLine> & Pick<SaleLine, "id">): SaleLine {
  return {
    productId: "p1",
    name: "Item",
    inputMode: "quantity",
    quantity: 1,
    unitPriceUgx: 1000,
    unitCostUgx: 500,
    lineTotalUgx: 1000,
    estimatedProfitUgx: 500,
    ...overrides,
  };
}

function sale(overrides: Partial<Sale> & Pick<Sale, "id" | "lines">): Sale {
  return {
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    subtotalUgx: 1000,
    totalUgx: 1000,
    cashPaidUgx: 1000,
    debtUgx: 0,
    estimatedProfitUgx: 500,
    pendingSync: false,
    ...overrides,
  };
}

describe("readLocalFinancialFingerprint", () => {
  beforeEach(() => {
    usePosStore.setState({ sales: [], archivedSales: [] });
  });

  it("is empty when nothing has ever been corrected", () => {
    usePosStore.setState({
      sales: [sale({ id: "s1", lines: [line({ id: "11111111-1111-4111-8111-111111111111" })] })],
    });
    const fp = readLocalFinancialFingerprint();
    expect(fp).toEqual({ correctedLineCount: 0, revisionSum: 0, revisionMax: 0, correctedLinesDigest: "" });
  });

  it("includes only lines with financialRevision > 0", () => {
    usePosStore.setState({
      sales: [
        sale({
          id: "s1",
          lines: [
            line({ id: "11111111-1111-4111-8111-111111111111", financialRevision: 1 }),
            line({ id: "22222222-2222-4222-8222-222222222222" }), // never corrected
          ],
        }),
      ],
    });
    const fp = readLocalFinancialFingerprint();
    expect(fp.correctedLineCount).toBe(1);
    expect(fp.revisionSum).toBe(1);
    expect(fp.revisionMax).toBe(1);
    expect(fp.correctedLinesDigest).not.toBe("");
  });

  it("includes archivedSales, matching the cloud side's completed-sale-line scope", () => {
    usePosStore.setState({
      sales: [],
      archivedSales: [
        sale({
          id: "s-archived",
          lines: [line({ id: "33333333-3333-4333-8333-333333333333", financialRevision: 2 })],
        }),
      ],
    });
    const fp = readLocalFinancialFingerprint();
    expect(fp.correctedLineCount).toBe(1);
    expect(fp.revisionMax).toBe(2);
  });

  it("excludes pending and cancelled sales entirely (they never reach sale_line_items server-side)", () => {
    usePosStore.setState({
      sales: [
        sale({
          id: "s-pending",
          status: "pending",
          lines: [line({ id: "44444444-4444-4444-8444-444444444444", financialRevision: 5 })],
        }),
        sale({
          id: "s-cancelled",
          status: "cancelled",
          lines: [line({ id: "55555555-5555-4555-8555-555555555555", financialRevision: 5 })],
        }),
      ],
    });
    const fp = readLocalFinancialFingerprint();
    expect(fp.correctedLineCount).toBe(0);
  });

  it("includes a voided-but-present line (still exists in sale_line_items server-side)", () => {
    usePosStore.setState({
      sales: [
        sale({
          id: "s1",
          lines: [line({ id: "66666666-6666-4666-8666-666666666666", financialRevision: 1, voided: true })],
        }),
      ],
    });
    expect(readLocalFinancialFingerprint().correctedLineCount).toBe(1);
  });

  it("safely ignores a line with a missing/invalid id instead of crashing or corrupting the digest", () => {
    usePosStore.setState({
      sales: [
        sale({
          id: "s1",
          lines: [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { ...line({ id: "unused" }), id: undefined, financialRevision: 3 } as any,
            line({ id: "77777777-7777-4777-8777-777777777777", financialRevision: 1 }),
          ],
        }),
      ],
    });
    const fp = readLocalFinancialFingerprint();
    expect(fp.correctedLineCount).toBe(1);
    expect(fp.revisionSum).toBe(1);
  });

  it("produces a stable digest regardless of line order (sorted by id before hashing)", () => {
    usePosStore.setState({
      sales: [
        sale({
          id: "s1",
          lines: [
            line({ id: "88888888-8888-4888-8888-888888888888", financialRevision: 1 }),
            line({ id: "11111111-1111-4111-8111-111111111111", financialRevision: 2 }),
          ],
        }),
      ],
    });
    const digestA = readLocalFinancialFingerprint().correctedLinesDigest;

    usePosStore.setState({
      sales: [
        sale({
          id: "s1",
          lines: [
            line({ id: "11111111-1111-4111-8111-111111111111", financialRevision: 2 }),
            line({ id: "88888888-8888-4888-8888-888888888888", financialRevision: 1 }),
          ],
        }),
      ],
    });
    const digestB = readLocalFinancialFingerprint().correctedLinesDigest;
    expect(digestA).toBe(digestB);
  });
});

describe("buildCloudTrustCertificationReport financial fingerprint gate", () => {
  beforeEach(() => {
    usePosStore.setState({ sales: [], archivedSales: [] });
  });

  it("fails certification when local shows a correction the cloud fingerprint doesn't know about", () => {
    usePosStore.setState({
      sales: [
        sale({
          id: "s1",
          lines: [line({ id: "11111111-1111-4111-8111-111111111111", financialRevision: 1 })],
        }),
      ],
    });
    const report = buildCloudTrustCertificationReport({
      cloud: BASE_COUNTS,
      local: BASE_COUNTS,
      requireCloudParity: true,
      cloudFinancialFingerprint: {
        fingerprint: { correctedLineCount: 0, revisionSum: 0, revisionMax: 0, correctedLinesDigest: "" },
        error: null,
      },
    });
    expect(report.financialFingerprint.match).toBe(false);
    expect(report.failures).toContain("financial_fingerprint_mismatch");
    expect(report.certified).toBe(false);
  });

  it("fails certification when the entity ROW COUNTS match but the corrected-line revision differs (the exact stale-snapshot scenario this exists to catch)", () => {
    usePosStore.setState({
      sales: [
        sale({
          id: "s1",
          lines: [line({ id: "11111111-1111-4111-8111-111111111111", financialRevision: 2 })],
        }),
      ],
    });
    const report = buildCloudTrustCertificationReport({
      cloud: { ...BASE_COUNTS, sales: 1 },
      local: { ...BASE_COUNTS, sales: 1 },
      requireCloudParity: true,
      cloudFinancialFingerprint: {
        // Same corrected-line COUNT (1) as local, but stale revision (1 instead of 2) —
        // a plain entity-count check would see sales:1 === sales:1 and pass.
        fingerprint: { correctedLineCount: 1, revisionSum: 1, revisionMax: 1, correctedLinesDigest: "stale-digest" },
        error: null,
      },
    });
    expect(report.financialFingerprint.match).toBe(false);
    expect(report.failures).toContain("financial_fingerprint_mismatch");
    expect(report.certified).toBe(false);
  });

  it("passes certification when local and cloud fingerprints agree", () => {
    usePosStore.setState({
      sales: [
        sale({
          id: "s1",
          lines: [line({ id: "11111111-1111-4111-8111-111111111111", financialRevision: 1 })],
        }),
      ],
    });
    const local = readLocalFinancialFingerprint();
    const report = buildCloudTrustCertificationReport({
      cloud: BASE_COUNTS,
      local: BASE_COUNTS,
      requireCloudParity: true,
      cloudFinancialFingerprint: { fingerprint: local, error: null },
    });
    expect(report.financialFingerprint.match).toBe(true);
    expect(report.failures).not.toContain("financial_fingerprint_mismatch");
  });

  it("does not affect certification when the fingerprint isn't requested at all (backward compatible)", () => {
    const report = buildCloudTrustCertificationReport({
      cloud: BASE_COUNTS,
      local: BASE_COUNTS,
      requireCloudParity: true,
    });
    expect(report.failures).not.toContain("financial_fingerprint_mismatch");
  });
});
