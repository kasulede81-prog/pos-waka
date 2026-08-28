import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, SaleLine } from "../types";
import { deleteKv, readKv, writeKv } from "./localDb";
import {
  readPersistedDraft,
  resolveDraftFromPersisted,
  writePersistedDraft,
  type PersistedDraftV1,
} from "./draftStorage";

const mem = new Map<string, unknown>();

beforeEach(() => {
  mem.clear();
  vi.mocked(writeKv).mockImplementation(async (_key, value) => {
    mem.set("draft_sale", value);
  });
  vi.mocked(readKv).mockImplementation(async () => (mem.get("draft_sale") as never) ?? null);
  vi.mocked(deleteKv).mockImplementation(async () => {
    mem.delete("draft_sale");
  });
});

const product: Product = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Soap",
  sellingPricePerUnitUgx: 10_000,
  costPricePerUnitUgx: 3_000,
  stockOnHand: 20,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 1,
};

const line: SaleLine = {
  id: "line-1",
  productId: product.id,
  name: "Soap",
  inputMode: "quantity",
  quantity: 1,
  unitPriceUgx: 10_000,
  unitCostUgx: 3_000,
  lineTotalUgx: 10_000,
  estimatedProfitUgx: 7_000,
  updatedAt: "2026-06-02T10:00:00.000Z",
};

describe("draftStorage v2", () => {
  it("persists active pending id, customer identity, and payment method — not credentials", async () => {
    await writePersistedDraft({
      lines: [line],
      input: null,
      activePendingSaleId: "pending-1",
      draftSaleCustomerId: "cust-1",
      draftSaleCustomerName: "Jane",
      draftSaleCustomerPhone: "0700000000",
      draftPaymentMethod: "mobile_money",
    });
    const written = vi.mocked(writeKv).mock.calls.at(-1)?.[1] as PersistedDraftV1 | undefined;
    expect(written?.v).toBe(2);
    expect(written?.activePendingSaleId).toBe("pending-1");
    expect(written?.draftSaleCustomerId).toBe("cust-1");
    expect(written?.draftSaleCustomerName).toBe("Jane");
    expect(written?.draftSaleCustomerPhone).toBe("0700000000");
    expect(written?.draftPaymentMethod).toBe("mobile_money");
    expect(JSON.stringify(written)).not.toMatch(/pin|cvv|token|cardNumber/i);
    const resolved = resolveDraftFromPersisted(written!, [product]);
    expect(resolved.activePendingSaleId).toBe("pending-1");
    expect(resolved.draftPaymentMethod).toBe("mobile_money");
  });

  it("still reads v1 drafts without a pending id", async () => {
    mem.set("draft_sale", { v: 1, draftLines: [line], draftInput: null });
    const row = await readPersistedDraft();
    expect(row?.v).toBe(1);
    const resolved = resolveDraftFromPersisted(row!, [product]);
    expect(resolved.draftLines).toHaveLength(1);
    expect(resolved.activePendingSaleId).toBeNull();
    expect(resolved.draftPaymentMethod).toBe("cash");
  });
});
