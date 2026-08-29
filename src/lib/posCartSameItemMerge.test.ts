import { beforeEach, describe, expect, it } from "vitest";
import type { Product } from "../types";
import { computeDraftCartStats } from "./draftCart";
import { usePosStore } from "../store/usePosStore";

const LAPTOP: Product = {
  id: "elitebook-840",
  name: "Elitebook 840",
  sellingMode: "unit",
  baseUnit: "piece",
  sellingPricePerUnitUgx: 550_000,
  costPricePerUnitUgx: 400_000,
  stockOnHand: 10,
  minimumStockAlert: 1,
  category: "Laptops",
  sku: "",
  updatedAt: "2026-08-29T08:00:00.000Z",
  version: 1,
};

describe("POS cart same-item count-up", () => {
  beforeEach(() => {
    usePosStore.getState().resetForSignOut();
    usePosStore.setState({
      _hydrated: true,
      products: [LAPTOP],
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
      activePendingSaleId: null,
    });
  });

  it("quantity tap-add merges into one line and increments count", () => {
    const store = usePosStore.getState();
    store.setDraftInput({ product: LAPTOP, inputMode: "quantity", value: 1 });
    expect(store.addDraftLineFromInput().ok).toBe(true);
    usePosStore.getState().setDraftInput({ product: LAPTOP, inputMode: "quantity", value: 1 });
    expect(usePosStore.getState().addDraftLineFromInput().ok).toBe(true);

    const lines = usePosStore.getState().draftLines;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(2);
    expect(lines[0]?.lineTotalUgx).toBe(1_100_000);
    const stats = computeDraftCartStats(lines);
    expect(stats.productCount).toBe(1);
    expect(stats.unitCount).toBe(2);
  });

  it("money tap-add merges into one line instead of a second row", () => {
    usePosStore.getState().setDraftInput({ product: LAPTOP, inputMode: "money", value: 550_000 });
    expect(usePosStore.getState().addDraftLineFromInput().ok).toBe(true);
    usePosStore.getState().setDraftInput({ product: LAPTOP, inputMode: "money", value: 550_000 });
    expect(usePosStore.getState().addDraftLineFromInput().ok).toBe(true);

    const lines = usePosStore.getState().draftLines;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.lineTotalUgx).toBe(1_100_000);
    expect(lines[0]?.quantity).toBe(2);
  });

  it("+/- steps the merged line quantity", () => {
    usePosStore.getState().setDraftInput({ product: LAPTOP, inputMode: "quantity", value: 1 });
    expect(usePosStore.getState().addDraftLineFromInput().ok).toBe(true);
    expect(usePosStore.getState().adjustDraftLineQuantity(LAPTOP.id, 1).ok).toBe(true);
    expect(usePosStore.getState().draftLines[0]?.quantity).toBe(2);
    expect(usePosStore.getState().adjustDraftLineQuantity(LAPTOP.id, -1).ok).toBe(true);
    expect(usePosStore.getState().draftLines[0]?.quantity).toBe(1);
  });

  it("+/- works after a money-mode add by converting to quantity", () => {
    usePosStore.getState().setDraftInput({ product: LAPTOP, inputMode: "money", value: 550_000 });
    expect(usePosStore.getState().addDraftLineFromInput().ok).toBe(true);
    expect(usePosStore.getState().adjustDraftLineQuantity(LAPTOP.id, 1).ok).toBe(true);
    const line = usePosStore.getState().draftLines[0]!;
    expect(line.inputMode).toBe("quantity");
    expect(line.quantity).toBe(2);
    expect(line.lineTotalUgx).toBe(1_100_000);
  });
});
